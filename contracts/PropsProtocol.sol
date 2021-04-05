// SPDX-License-Identifier: MIT

pragma solidity 0.7.3;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/math/SignedSafeMathUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";

import "./IPropsProtocol.sol";
import "./tokens/props/IPropsTokenL2.sol";
import "./tokens/props/IRPropsToken.sol";
import "./tokens/props/ISPropsToken.sol";
import "./staking/IStaking.sol";
import "./utils/MetaTransactionProvider.sol";

/**
 * @title  PropsProtocol
 * @author Props
 * @notice Entry point for participating in the Props protocol. All user actions
 *         are to be done exclusively through this contract.
 * @dev    It is responsible for proxying staking-related actions to the appropriate
 *         staking contracts. Moreover, it also handles sProps minting and burning,
 *         sProps staking, swapping earned rProps for regular Props and escrowing
 *         user Props rewards.
 */
contract PropsProtocol is
    Initializable,
    PausableUpgradeable,
    MetaTransactionProvider,
    IPropsProtocol
{
    using SafeMathUpgradeable for uint256;
    using SafeERC20Upgradeable for IERC20Upgradeable;

    /**************************************
                     FIELDS
    ***************************************/

    // The Props protocol controller
    address public controller;

    // The Props protocol guardian (has the ability to pause/unpause the protocol)
    address public guardian;

    // Props protocol related tokens
    address public propsToken;
    address public sPropsToken;
    address public rPropsToken;

    // The factory contract for deploying new apps
    address public appProxyFactory;

    // The staking contract for earning apps Props rewards
    address public propsAppStaking;
    // The staking contract for earning users Props rewards
    address public propsUserStaking;

    // Mapping from app points contract to the associated app points staking contract
    mapping(address => address) public appPointsStaking;

    // Mapping of the total amount of Props staked by each user to every app
    // eg. stakes[userAddress][appPointsAddress]
    mapping(address => mapping(address => uint256)) public stakes;

    // Mapping from app to the associated total amount of Props staked to it
    mapping(address => uint256) public appStakes;

    // Mapping from user account to the associated total amount of Props principal staked
    mapping(address => uint256) public totalPrincipalStaked;
    // Mapping from user account to the associated total amount of Props rewards staked
    mapping(address => uint256) public totalRewardsStaked;

    // Keeps track of the staking delegatees of users
    mapping(address => address) public delegatee;

    // Mapping of the total amount of escrowed rewards of each user
    mapping(address => uint256) public rewardsEscrow;
    // Mapping of the unlock time for the escrowed rewards of each user
    mapping(address => uint256) public rewardsEscrowUnlock;

    // The cooldown period for the rewards escrow (in seconds)
    uint256 public rewardsEscrowCooldown;

    // Keeps track of the protocol-whitelisted apps
    mapping(address => bool) private appWhitelist;

    /**************************************
                     EVENTS
    ***************************************/

    event AccountDataUpdated(
        address indexed account,
        uint256 totalPrincipalStaked,
        uint256 totalRewardsStaked
    );
    event AppDataUpdated(address indexed app, uint256 totalStaked);
    event AppPointsRewardsClaimed(address indexed app, address indexed account, uint256 amount);
    event AppWhitelistUpdated(address indexed app, bool status);
    event DelegateChanged(address indexed delegator, address indexed delegatee);
    event PropsRewardsClaimed(address indexed account, uint256 amount, bool isAppReward);
    event RewardsEscrowUpdated(address indexed account, uint256 lockedAmount, uint256 unlockTime);
    event StakeUpdated(address indexed app, address indexed account, uint256 amount);

    /**************************************
                    MODIFIERS
    ***************************************/

    modifier only(address _account) {
        require(_msgSender() == _account, "Unauthorized");
        _;
    }

    modifier notSet(address _field) {
        require(_field == address(0), "Already set");
        _;
    }

    modifier validApp(address _app) {
        require(appPointsStaking[_app] != address(0), "Invalid app");
        _;
    }

    /***************************************
                   INITIALIZER
    ****************************************/

    /**
     * @dev Initializer.
     * @param _controller The Props protocol controller
     * @param _guardian The Props protocol guardian
     * @param _propsToken The Props token contract
     */
    function initialize(
        address _controller,
        address _guardian,
        address _propsToken
    ) public initializer {
        PausableUpgradeable.__Pausable_init();
        MetaTransactionProvider.__MetaTransactionProvider_init("PropsProtocol", "1");

        controller = _controller;
        guardian = _guardian;
        propsToken = _propsToken;
        rewardsEscrowCooldown = 90 days;
    }

    /***************************************
                GUARDIAN ACTIONS
    ****************************************/

    /**
     * @dev Pause the protocol.
     */
    function pause() external {
        require(_msgSender() == controller || _msgSender() == guardian, "Unauthorized");
        _pause();
    }

    /**
     * @dev Unpause the protocol.
     */
    function unpause() external {
        require(_msgSender() == controller || _msgSender() == guardian, "Unauthorized");
        _unpause();
    }

    /***************************************
                CONTROLLER ACTIONS
    ****************************************/

    /**
     * @dev Transfer the control of the contract to a new address.
     * @param _controller The new controller
     */
    function transferControl(address _controller) external only(controller) {
        require(_controller != address(0), "Cannot be set to the zero address");
        controller = _controller;
    }

    /**
     * @dev Transfer the guardian role to a new address.
     * @param _guardian The new guardian
     */
    function transferGuardianship(address _guardian) external only(controller) {
        require(_guardian != address(0), "Cannot be set to the zero address");
        guardian = _guardian;
    }

    /*
     * The following set methods are required to be called before any contract interaction:
     * - setAppProxyFactory
     * - setRPropsToken
     * - setSPropsToken
     * - setPropsAppStaking
     * - setPropsUserStaking
     *
     * ! `setRPropsToken` must be called before `setPropsAppStaking` and `setPropsUserStaking` !
     */

    /**
     * @dev Set the app proxy factory contract.
     * @param _appProxyFactory The address of the app proxy factory contract
     */
    function setAppProxyFactory(address _appProxyFactory)
        external
        only(controller)
        notSet(appProxyFactory)
    {
        appProxyFactory = _appProxyFactory;
    }

    /**
     * @dev Set the rProps token contract.
     * @param _rPropsToken The address of the rProps token contract
     */
    function setRPropsToken(address _rPropsToken) external only(controller) notSet(rPropsToken) {
        rPropsToken = _rPropsToken;
    }

    /**
     * @dev Set the sProps token contract.
     * @param _sPropsToken The address of the sProps token contract
     */
    function setSPropsToken(address _sPropsToken) external only(controller) notSet(sPropsToken) {
        sPropsToken = _sPropsToken;
    }

    /**
     * @dev Set the staking contract for earning apps Props rewards.
     * @param _propsAppStaking The address of the staking contract for earning apps Props rewards
     */
    function setPropsAppStaking(address _propsAppStaking)
        external
        only(controller)
        notSet(propsAppStaking)
    {
        propsAppStaking = _propsAppStaking;
        IRPropsToken(rPropsToken).setPropsAppStaking(_propsAppStaking);
    }

    /**
     * @dev Set the staking contract for earning users Props rewards.
     * @param _propsUserStaking The address of the staking contract for earning users Props rewards.
     */
    function setPropsUserStaking(address _propsUserStaking)
        external
        only(controller)
        notSet(propsUserStaking)
    {
        propsUserStaking = _propsUserStaking;
        IRPropsToken(rPropsToken).setPropsUserStaking(_propsUserStaking);
    }

    /**
     * @dev Change the cooldown period for the escrowed rewards.
     * @param _rewardsEscrowCooldown The cooldown period for the escrowed rewards
     */
    function changeRewardsEscrowCooldown(uint256 _rewardsEscrowCooldown) external only(controller) {
        rewardsEscrowCooldown = _rewardsEscrowCooldown;
    }

    /**
     * @dev Update the app whitelist.
     * @param _app The address of the app to update the whitelist status of
     * @param _status The whitelist status of the app
     */
    function updateAppWhitelist(address _app, bool _status) external only(controller) {
        require(appWhitelist[_app] != _status, "Invalid status");

        if (appStakes[_app] > 0) {
            if (_status == true) {
                // On whitelisting, re-stake all Props previously staked to the app
                IStaking(propsAppStaking).stake(_app, appStakes[_app]);
            } else {
                // On blacklisting, unstake all Props staked to the app
                IStaking(propsAppStaking).withdraw(_app, appStakes[_app]);
            }
        }

        appWhitelist[_app] = _status;
        emit AppWhitelistUpdated(_app, _status);
    }

    /**
     * @dev Distribute the rProps rewards to the app and user Props staking contracts.
     * @param _amount The amount of rProps to mint and get distributed as staking rewards
     * @param _appRewardsPercentage The percentage of minted rProps to go to the app Props staking contract
     * @param _userRewardsPercentage The percentage of minted rProps to go to the user Props staking contract
     */
    function distributePropsRewards(
        uint256 _amount,
        uint256 _appRewardsPercentage,
        uint256 _userRewardsPercentage
    ) external only(controller) {
        IRPropsToken(rPropsToken).distributeRewards(
            _amount,
            _appRewardsPercentage,
            _userRewardsPercentage
        );
    }

    /**
     * @dev Withdraw rProps rewards from the app and user staking contracts.
     * @param _appRewardsAmount The amount of rProps rewards to withdraw from the app Props staking contract
     * @param _userRewardsAmount The amount of rProps rewards to withdraw from the user Props staking contract
     */
    function withdrawPropsRewards(uint256 _appRewardsAmount, uint256 _userRewardsAmount)
        external
        only(controller)
    {
        IRPropsToken(rPropsToken).withdrawRewards(_appRewardsAmount, _userRewardsAmount);
    }

    /**
     * @dev Change the daily reward emission parameter on the app Props staking contract.
     * @param _appDailyRewardEmission The new daily reward emission rate
     */
    function changeDailyAppRewardEmission(uint256 _appDailyRewardEmission)
        external
        only(controller)
    {
        IRPropsToken(rPropsToken).changeDailyAppRewardEmission(_appDailyRewardEmission);
    }

    /**
     * @dev Change the daily reward emission parameter on the user Props staking contract.
     * @param _userDailyRewardEmission The new daily reward emission rate
     */
    function changeDailyUserRewardEmission(uint256 _userDailyRewardEmission)
        external
        only(controller)
    {
        IRPropsToken(rPropsToken).changeDailyUserRewardEmission(_userDailyRewardEmission);
    }

    /***************************************
               APP FACTORY ACTIONS
    ****************************************/

    /**
     * @dev Save identification information for a newly deployed app.
     * @param _appPoints The address of the app points contract
     * @param _appPointsStaking The address of the app points staking contract
     */
    function saveApp(address _appPoints, address _appPointsStaking)
        external
        override
        only(appProxyFactory)
    {
        appPointsStaking[_appPoints] = _appPointsStaking;
    }

    /***************************************
                  USER ACTIONS
    ****************************************/

    /**
     * @dev Delegate staking rights.
     * @param _to The account to delegate to
     */
    function delegate(address _to) external whenNotPaused {
        delegatee[_msgSender()] = _to;
        emit DelegateChanged(_msgSender(), _to);
    }

    /**
     * @dev Stake on behalf of an account. It makes it possible to easily
     *      transfer a staking portofolio to someone else. The staked Props
     *      are transferred from the sender's account but staked on behalf of
     *      the requested account.
     * @param _apps Array of apps to stake to
     * @param _amounts Array of amounts to stake to each app
     * @param _account Account to stake on behalf of
     */
    function stakeOnBehalf(
        address[] memory _apps,
        uint256[] memory _amounts,
        address _account
    ) public whenNotPaused {
        require(_apps.length == _amounts.length, "Invalid input");

        for (uint256 i = 0; i < _apps.length; i++) {
            if (_amounts[i] > 0) {
                // Transfer the needed Props from the sender
                IERC20Upgradeable(propsToken).safeTransferFrom(
                    _msgSender(),
                    address(this),
                    _amounts[i]
                );

                // Do the actual stake on behalf of the given account
                _stake(_apps[i], _amounts[i], _account, StakeMode.Principal);
            }
        }
    }

    /**
     * @dev Stake to apps.
     * @param _apps Array of apps to stake to
     * @param _amounts Array of amounts to stake to each app
     */
    function stake(address[] memory _apps, uint256[] memory _amounts) public whenNotPaused {
        require(_apps.length == _amounts.length, "Invalid input");

        for (uint256 i = 0; i < _apps.length; i++) {
            if (_amounts[i] > 0) {
                // Transfer the needed Props from the sender
                IERC20Upgradeable(propsToken).safeTransferFrom(
                    _msgSender(),
                    address(this),
                    _amounts[i]
                );

                // Do the actual stake
                _stake(_apps[i], _amounts[i], _msgSender(), StakeMode.Principal);
            }
        }
    }

    /**
     * @dev Stake Props rewards to apps.
     * @param _apps Array of apps to stake to
     * @param _amounts Array of amounts to stake to each app
     */
    function stakeRewards(address[] memory _apps, uint256[] memory _amounts) public whenNotPaused {
        require(_apps.length == _amounts.length, "Invalid input");

        for (uint256 i = 0; i < _apps.length; i++) {
            if (_amounts[i] > 0) {
                // Get the needed Props from the sender's rewards escrow
                rewardsEscrow[_msgSender()] = rewardsEscrow[_msgSender()].sub(_amounts[i]);

                // Do the actual stake
                _stake(_apps[i], _amounts[i], _msgSender(), StakeMode.Rewards);
            }
        }

        emit RewardsEscrowUpdated(
            _msgSender(),
            rewardsEscrow[_msgSender()],
            rewardsEscrowUnlock[_msgSender()]
        );
    }

    /**
     * @dev Reallocate existing stake between apps.
     * @param _apps Array of apps to reallocate the stake of
     * @param _unstakeAmounts Array of amounts to unstake from each app
     * @param _stakeAmounts Array of amounts to stake to each app
     */
    function reallocateStakes(
        address[] calldata _apps,
        uint256[] calldata _unstakeAmounts,
        uint256[] calldata _stakeAmounts
    ) external {
        _reallocateStakes(_apps, _unstakeAmounts, _stakeAmounts, _msgSender());
    }

    /**
     * @dev Same as `reallocateStakes`, but act on behalf of a delegator.
     */
    function reallocateStakesAsDelegate(
        address[] calldata _apps,
        uint256[] calldata _unstakeAmounts,
        uint256[] calldata _stakeAmounts,
        address _account
    ) external only(delegatee[_account]) {
        _reallocateStakes(_apps, _unstakeAmounts, _stakeAmounts, _account);
    }

    /**
     * @dev Unstake from apps.
     * @param _apps Array of apps to unstake from
     * @param _amounts Array of amounts to unstake from each app
     * @param _principalAmount The amount of principal to get unstaked (the rest coming from the staked rewards)
     */
    function unstake(
        address[] calldata _apps,
        uint256[] calldata _amounts,
        uint256 _principalAmount
    ) external {
        require(_apps.length == _amounts.length, "Invalid input");

        for (uint256 i = 0; i < _apps.length; i++) {
            // Compute the amounts of principal and rewards that need to get unstaked
            uint256 principalToUnstake =
                _amounts[i] <= _principalAmount ? _amounts[i] : _principalAmount;
            uint256 rewardsToUnstake =
                _amounts[i] <= _principalAmount ? 0 : _amounts[i].sub(_principalAmount);

            // Handle principal unstakes
            if (principalToUnstake > 0) {
                // Transfer the principal back to the user
                IERC20Upgradeable(propsToken).safeTransfer(_msgSender(), principalToUnstake);

                // Do the actual principal unstake
                _unstake(_apps[i], principalToUnstake, _msgSender(), StakeMode.Principal);

                // Update corresponding parameters
                _principalAmount = _principalAmount.sub(principalToUnstake);
            }

            // Handle rewards unstakes
            if (rewardsToUnstake > 0) {
                // Put the rewards back into the escrow (extending its unlock time)
                rewardsEscrow[_msgSender()] = rewardsEscrow[_msgSender()].add(rewardsToUnstake);
                rewardsEscrowUnlock[_msgSender()] = block.timestamp.add(rewardsEscrowCooldown);

                // Do the actual rewards unstake
                _unstake(_apps[i], rewardsToUnstake, _msgSender(), StakeMode.Rewards);
            }
        }
    }

    /**
     * @dev Allow users to claim their app points rewards.
     * @param _apps Array of apps to claim the app points rewards of
     */
    function claimAppPointsRewards(address[] memory _apps) external whenNotPaused {
        for (uint256 i = 0; i < _apps.length; i++) {
            require(appPointsStaking[_apps[i]] != address(0), "Invalid app");

            // Claim the rewards and transfer them to the user's wallet
            uint256 reward = IStaking(appPointsStaking[_apps[i]]).earned(_msgSender());
            if (reward > 0) {
                IStaking(appPointsStaking[_apps[i]]).claimReward(_msgSender());
                IERC20Upgradeable(_apps[i]).safeTransfer(_msgSender(), reward);

                emit AppPointsRewardsClaimed(_apps[i], _msgSender(), reward);
            }
        }
    }

    /**
     * @dev Allow app owners to claim their app's Props rewards.
     * @param _app The app to claim the Props rewards of
     * @param _wallet The address claimed Props rewards are to be withdrawn to
     */
    function claimAppPropsRewards(address _app, address _wallet)
        external
        validApp(_app)
        only(OwnableUpgradeable(_app).owner())
        whenNotPaused
    {
        // Claim the rewards and transfer them to the user's wallet
        uint256 reward = IStaking(propsAppStaking).earned(_app);
        if (reward > 0) {
            IStaking(propsAppStaking).claimReward(_app);
            IERC20Upgradeable(rPropsToken).safeTransfer(_wallet, reward);
            // Since the rewards are in rProps, swap it for regular Props
            IRPropsToken(rPropsToken).swap(_wallet);

            emit PropsRewardsClaimed(_app, reward, true);
        }
    }

    /**
     * @dev Allow app owners to claim and directly stake their app's Props rewards.
     * @param _app The app to claim and stake the Props rewards of
     */
    function claimAppPropsRewardsAndStake(address _app)
        external
        validApp(_app)
        only(OwnableUpgradeable(_app).owner())
        whenNotPaused
    {
        uint256 reward = IStaking(propsAppStaking).earned(_app);
        if (reward > 0) {
            IStaking(propsAppStaking).claimReward(_app);
            // Since the rewards are in rProps, swap it for regular Props
            IRPropsToken(rPropsToken).swap(address(this));

            emit PropsRewardsClaimed(_app, reward, true);

            // Stake on behalf of the app owner
            // App Props rewards are never escrowed so we mark this as a stake from principal
            _stake(_app, reward, _msgSender(), StakeMode.Principal);
        }
    }

    /**
     * @dev Allow users to claim their Props rewards.
     */
    function claimUserPropsRewards() external whenNotPaused {
        uint256 reward = IStaking(propsUserStaking).earned(_msgSender());
        if (reward > 0) {
            // Claim the rewards but don't transfer them to the user's wallet
            IStaking(propsUserStaking).claimReward(_msgSender());
            // Since the rewards are in rProps, swap it for regular Props
            IRPropsToken(rPropsToken).swap(address(this));

            emit PropsRewardsClaimed(_msgSender(), reward, false);

            // Place the rewards in the escrow and extend the cooldown period
            rewardsEscrow[_msgSender()] = rewardsEscrow[_msgSender()].add(reward);
            rewardsEscrowUnlock[_msgSender()] = block.timestamp.add(rewardsEscrowCooldown);

            emit RewardsEscrowUpdated(
                _msgSender(),
                rewardsEscrow[_msgSender()],
                rewardsEscrowUnlock[_msgSender()]
            );
        }
    }

    /**
     * @dev Allow users to claim and directly stake their Props rewards, without
     *      having the rewards go through the escrow (and thus having the unlock
     *      time of the escrow extended).
     * @param _apps Array of apps to stake to
     * @param _percentages Array of percentages of the claimed rewards to stake to each app (denoted in ppm)
     */
    function claimUserPropsRewardsAndStake(
        address[] calldata _apps,
        uint256[] calldata _percentages
    ) external whenNotPaused {
        _claimUserPropsRewardsAndStake(_apps, _percentages, _msgSender());
    }

    /**
     * @dev Same as `claimUserPropsRewardsAndStake`, but act on behalf of a delegator.
     */
    function claimUserPropsRewardsAndStakeAsDelegate(
        address[] calldata _apps,
        uint256[] calldata _percentages,
        address _account
    ) external only(delegatee[_account]) whenNotPaused {
        _claimUserPropsRewardsAndStake(_apps, _percentages, _account);
    }

    /**
     * @dev Allow users to unlock their escrowed Props rewards.
     */
    function unlockUserPropsRewards() external whenNotPaused {
        require(block.timestamp >= rewardsEscrowUnlock[_msgSender()], "Rewards locked");

        if (rewardsEscrow[_msgSender()] > 0) {
            // Empty the escrow
            uint256 escrowedRewards = rewardsEscrow[_msgSender()];
            rewardsEscrow[_msgSender()] = 0;

            // Transfer the rewards to the user's wallet
            IERC20Upgradeable(propsToken).safeTransfer(_msgSender(), escrowedRewards);

            emit RewardsEscrowUpdated(_msgSender(), 0, 0);
        }
    }

    /***************************************
                     HELPERS
    ****************************************/

    function _msgSender()
        internal
        view
        override(ContextUpgradeable, MetaTransactionProvider)
        returns (address payable)
    {
        // Allow `permitAndCall` calls from the Props token contract
        if (msg.sender == propsToken) {
            return _extractMsgSender();
        }
        return MetaTransactionProvider._msgSender();
    }

    enum StakeMode {Principal, Rewards, Reallocation}

    function _stake(
        address _app,
        uint256 _amount,
        address _account,
        StakeMode _mode
    ) internal {
        // Can only stake to whitelisted apps
        require(appWhitelist[_app], "App not whitelisted");

        // Mint corresponding sProps
        ISPropsToken(sPropsToken).mint(_account, _amount);

        // Stake the Props in the user Props staking contract
        IStaking(propsUserStaking).stake(_account, _amount);

        // Stake the Props in the app Props staking contract
        IStaking(propsAppStaking).stake(_app, _amount);

        // Stake the Props in the app points staking contract
        IStaking(appPointsStaking[_app]).stake(_account, _amount);

        // Update global stake data
        stakes[_account][_app] = stakes[_account][_app].add(_amount);
        appStakes[_app] = appStakes[_app].add(_amount);

        if (_mode == StakeMode.Principal) {
            totalPrincipalStaked[_account] = totalPrincipalStaked[_account].add(_amount);
        } else if (_mode == StakeMode.Rewards) {
            totalRewardsStaked[_account] = totalRewardsStaked[_account].add(_amount);
        }

        emit AppDataUpdated(_app, appStakes[_app]);
        if (_mode != StakeMode.Reallocation) {
            emit AccountDataUpdated(
                _account,
                totalPrincipalStaked[_account],
                totalRewardsStaked[_account]
            );
        }
        emit StakeUpdated(_app, _account, IStaking(appPointsStaking[_app]).balanceOf(_account));
    }

    function _unstake(
        address _app,
        uint256 _amount,
        address _account,
        StakeMode _mode
    ) internal {
        // Unstakes can also happen from non-whitelisted apps
        require(appPointsStaking[_app] != address(0), "Invalid app");

        // Burn corresponding sProps
        ISPropsToken(sPropsToken).burn(_account, _amount);

        // Unstake the Props from the user Props staking contract
        IStaking(propsUserStaking).withdraw(_account, _amount);

        // Only if the app is whitelisted (blacklisted apps have no staked Props)
        if (appWhitelist[_app]) {
            // Unstake the Props from the app Props staking contract
            IStaking(propsAppStaking).withdraw(_app, _amount);
        }

        // Unstake the Props from the app points staking contract
        IStaking(appPointsStaking[_app]).withdraw(_account, _amount);

        // Update global stake data
        stakes[_account][_app] = stakes[_account][_app].sub(_amount);
        appStakes[_app] = appStakes[_app].sub(_amount);

        if (_mode == StakeMode.Principal) {
            totalPrincipalStaked[_account] = totalPrincipalStaked[_account].sub(_amount);
        } else if (_mode == StakeMode.Rewards) {
            totalRewardsStaked[_account] = totalRewardsStaked[_account].sub(_amount);
        }

        emit AppDataUpdated(_app, appStakes[_app]);
        if (_mode != StakeMode.Reallocation) {
            emit AccountDataUpdated(
                _account,
                totalPrincipalStaked[_account],
                totalRewardsStaked[_account]
            );
        }
        emit StakeUpdated(_app, _account, IStaking(appPointsStaking[_app]).balanceOf(_account));
    }

    function _reallocateStakes(
        address[] memory _apps,
        uint256[] memory _unstakeAmounts,
        uint256[] memory _stakeAmounts,
        address _account
    ) internal {
        require(_apps.length == _unstakeAmounts.length, "Invalid input");
        require(_apps.length == _stakeAmounts.length, "Invalid input");

        // In a reallocation, the the total staked amount must remain constant
        // That is, no new stake can be added and no existing stake can get withdrawn
        uint256 totalUnstakedAmount = 0;
        uint256 totalStakedAmount = 0;
        for (uint256 i = 0; i < _apps.length; i++) {
            totalUnstakedAmount = totalUnstakedAmount.add(_unstakeAmounts[i]);
            totalStakedAmount = totalStakedAmount.add(_stakeAmounts[i]);
        }
        require(totalStakedAmount == totalUnstakedAmount, "Invalid reallocation");

        // First, handle the unstakes to free funds that might be needed
        for (uint256 i = 0; i < _apps.length; i++) {
            if (_unstakeAmounts[i] > 0) {
                _unstake(_apps[i], _unstakeAmounts[i], _account, StakeMode.Reallocation);
            }
        }

        // Then, handle the stakes
        for (uint256 i = 0; i < _apps.length; i++) {
            if (_stakeAmounts[i] > 0) {
                _stake(_apps[i], _stakeAmounts[i], _account, StakeMode.Reallocation);
            }
        }
    }

    function _claimUserPropsRewardsAndStake(
        address[] memory _apps,
        uint256[] memory _percentages,
        address _account
    ) internal {
        require(_apps.length == _percentages.length, "Invalid input");

        uint256 reward = IStaking(propsUserStaking).earned(_account);
        if (reward > 0) {
            // Claim the rewards but don't transfer them to the user's wallet
            IStaking(propsUserStaking).claimReward(_account);
            // Since the rewards are in rProps, swap it for regular Props
            IRPropsToken(rPropsToken).swap(address(this));

            emit PropsRewardsClaimed(_account, reward, false);

            // Calculate amounts from the given percentages
            uint256 totalPercentage = 0;
            uint256 totalAmountSoFar = 0;
            uint256[] memory amounts = new uint256[](_percentages.length);
            for (uint256 i = 0; i < _apps.length; i++) {
                if (i < _percentages.length.sub(1)) {
                    amounts[i] = reward.mul(_percentages[i]).div(1e6);
                } else {
                    // Make sure nothing gets lost
                    amounts[i] = reward.sub(totalAmountSoFar);
                }

                totalPercentage = totalPercentage.add(_percentages[i]);
                totalAmountSoFar = totalAmountSoFar.add(amounts[i]);
            }
            // The given percentages must add up to 100%
            require(totalPercentage == 1e6, "Invalid percentages");

            // Do the actual rewards stakes to apps
            for (uint256 i = 0; i < _apps.length; i++) {
                if (amounts[i] > 0) {
                    _stake(_apps[i], amounts[i], _account, StakeMode.Rewards);
                }
            }

            emit RewardsEscrowUpdated(
                _account,
                rewardsEscrow[_account],
                rewardsEscrowUnlock[_account]
            );
        }
    }
}
