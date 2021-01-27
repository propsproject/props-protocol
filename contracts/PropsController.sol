// SPDX-License-Identifier: MIT
pragma solidity >=0.6.0 <0.7.0;

import "@openzeppelin/contracts-upgradeable/math/SignedSafeMathUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/SafeERC20Upgradeable.sol";

import "./interfaces/IAppToken.sol";
import "./interfaces/IOwnable.sol";
import "./interfaces/IPropsController.sol";
import "./interfaces/IPropsToken.sol";
import "./interfaces/ISPropsToken.sol";
import "./interfaces/IRPropsToken.sol";
import "./interfaces/IStaking.sol";
import "./utils/Ownable.sol";

/**
 * @title  PropsController
 * @author Props
 * @notice Entry point for participating in the Props protocol. All user actions
 *         should be done exclusively through this contract.
 * @dev    It is responsible for proxying staking-related actions to the appropiate
 *         app token staking contracts. Moreover, tt also handles sProps minting
 *         and burning, sProps staking, swapping earned rProps for regular Props and
 *         locking users Props rewards.
 */
contract PropsController is Initializable, Ownable, IPropsController {
    using SafeMathUpgradeable for uint256;
    using SafeERC20Upgradeable for IERC20Upgradeable;

    // The Props protocol guardian (has the ability to pause/unpause the protocol)
    address public propsGuardian;

    address public propsToken;
    address public sPropsToken;
    address public rPropsToken;

    // The factory contract for deploying new app tokens
    address public appTokenProxyFactory;

    // The sProps staking contract for app Props rewards
    address public sPropsAppStaking;
    // The sProps staking contract for user Props rewards
    address public sPropsUserStaking;

    // Mapping of the app token staking contract of each app token
    mapping(address => address) public appTokenToStaking;

    // Mapping of the total amount staked of each user across all app tokens
    mapping(address => mapping(address => uint256)) public userStakes;
    // Mapping of the total locked rewards amount staked of each user across all app tokens
    mapping(address => mapping(address => uint256)) public userRewardStakes;

    // Mapping of the staking delegatee of each user
    mapping(address => address) public delegates;

    // Mapping of the total amount of escrowed rewards of each user
    mapping(address => uint256) public rewardsEscrow;
    // Mapping of the unlock time for the escrowed rewards of each user
    mapping(address => uint256) public rewardsEscrowUnlock;

    // The cooldown period for the rewards escrow
    uint256 public rewardsEscrowCooldown;

    // Set of whitelisted app tokens
    mapping(address => uint8) private appTokensWhitelist;

    bool public paused;

    /**************************************
                     EVENTS
    ***************************************/

    event Stake(address indexed appToken, address indexed account, int256 amount);
    event RewardsStake(address indexed appToken, address indexed account, int256 amount);
    event RewardsEscrowUpdated(address indexed account, uint256 lockedAmount, uint256 unlockTime);
    event AppTokenWhitelisted(address indexed appToken);
    event AppTokenBlacklisted(address indexed appToken);
    event DelegateChanged(address indexed delegator, address indexed delegatee);
    event Paused();
    event Unpaused();

    /***************************************
                   INITIALIZER
    ****************************************/

    /**
     * @dev Initializer.
     * @param _owner The owner of the contract
     * @param _propsGuardian The Props protocol guardian
     * @param _propsToken The Props token contract
     */
    function initialize(
        address _owner,
        address _propsGuardian,
        address _propsToken
    ) public initializer {
        Ownable.__Ownable_init();

        if (_owner != msg.sender) {
            transferOwnership(_owner);
        }

        propsGuardian = _propsGuardian;
        propsToken = _propsToken;
        rewardsEscrowCooldown = 90 days;
    }

    /**
     * @dev Save an app token and its associated staking contract (to be called
     *      only by the app token factory contract).
     * @param _appToken The app token contract address
     * @param _appTokenStaking The app token staking contract address
     */
    function saveAppToken(address _appToken, address _appTokenStaking) external override {
        _requireNotPaused();
        require(msg.sender == appTokenProxyFactory, "Unauthorized");

        appTokenToStaking[_appToken] = _appTokenStaking;
    }

    /***************************************
                     ACTIONS
    ****************************************/

    /**
     * @dev Delegate staking rights.
     * @param _to The account to delegate to
     */
    function delegate(address _to) external {
        delegates[msg.sender] = _to;
        emit DelegateChanged(msg.sender, _to);
    }

    /**
     * @dev Stake on behalf of an account. It makes it possible to easily
     *      transfer a staking portofolio to someone else. The staked Props
     *      are transferred from the sender's account but staked on behalf of
     *      the requested account.
     * @param _appTokens Array of app tokens to stake to
     * @param _amounts Array of amounts to stake to each app token
     * @param _account Account to stake on behalf of
     */
    function stakeOnBehalf(
        address[] memory _appTokens,
        uint256[] memory _amounts,
        address _account
    ) public {
        _requireNotPaused();

        // Convert from uint256 to int256
        int256[] memory amounts = new int256[](_amounts.length);
        for (uint8 i = 0; i < _amounts.length; i++) {
            amounts[i] = _safeInt256(_amounts[i]);
        }

        _stake(_appTokens, amounts, msg.sender, _account, false);
    }

    /**
     * @dev Use an off-chain signature to approve and stake on behalf in the same transaction.
     */
    function stakeOnBehalfBySig(
        address[] memory _appTokens,
        uint256[] memory _amounts,
        address _account,
        address _owner,
        address _spender,
        uint256 _amount,
        uint256 _deadline,
        uint8 _v,
        bytes32 _r,
        bytes32 _s
    ) public {
        _requireNotPaused();

        IPropsToken(propsToken).permit(_owner, _spender, _amount, _deadline, _v, _r, _s);
        stakeOnBehalf(_appTokens, _amounts, _account);
    }

    /**
     * @dev Stake/unstake to/from app tokens. This function is used for both
     *      staking to and unstaking from app tokens. It accepts both positive
     *      and negative amounts, which represent an adjustment to the staked
     *      amount to the corresponding app token.
     * @param _appTokens Array of app tokens to stake/unstake to/from
     * @param _amounts Array of amounts to stake/unstake to/from each app token
     */
    function stake(address[] memory _appTokens, int256[] memory _amounts) public {
        _requireNotPaused();

        _stake(_appTokens, _amounts, msg.sender, msg.sender, false);
    }

    /**
     * @dev Use an off-chain signature to approve and stake in the same transaction.
     */
    function stakeBySig(
        address[] calldata _appTokens,
        int256[] calldata _amounts,
        address _owner,
        address _spender,
        uint256 _amount,
        uint256 _deadline,
        uint8 _v,
        bytes32 _r,
        bytes32 _s
    ) external {
        _requireNotPaused();

        IPropsToken(propsToken).permit(_owner, _spender, _amount, _deadline, _v, _r, _s);
        stake(_appTokens, _amounts);
    }

    /**
     * @dev Stake on behalf of the delegator account.
     * @param _appTokens Array of app tokens to stake/unstake to/from
     * @param _amounts Array of amounts to stake/unstake to/from each app token
     * @param _account Delegator account to stake on behalf of
     */
    function stakeAsDelegate(
        address[] memory _appTokens,
        int256[] memory _amounts,
        address _account
    ) public {
        _requireNotPaused();
        require(msg.sender == delegates[_account], "Unauthorized");

        _stake(_appTokens, _amounts, _account, _account, false);
    }

    /**
     * @dev Similar to `stake`, this function is used to stake/unstake to/from
     *      app tokens. The only difference is that it uses the escrowed
     *      rewards instead of transferring from the user's wallet.
     * @param _appTokens Array of app tokens to stake/unstake to/from
     * @param _amounts Array of amounts to stake/unstake to/from each app token
     */
    function stakeRewards(address[] memory _appTokens, int256[] memory _amounts) public {
        _requireNotPaused();

        _stake(_appTokens, _amounts, msg.sender, msg.sender, true);
    }

    /**
     * @dev Stake rewards on behalf of the delegator account.
     * @param _appTokens Array of app tokens to stake/unstake to/from
     * @param _amounts Array of amounts to stake/unstake to/from each app token
     * @param _account Delegator account to stake on behalf of
     */
    function stakeRewardsAsDelegate(
        address[] memory _appTokens,
        int256[] memory _amounts,
        address _account
    ) public {
        _requireNotPaused();
        require(msg.sender == delegates[_account]);

        _stake(_appTokens, _amounts, _account, _account, true);
    }

    /**
     * @dev Allow users to claim their app token rewards.
     * @param _appToken The app token to claim the rewards for
     */
    function claimAppTokenRewards(address _appToken) external {
        _requireNotPaused();
        require(appTokenToStaking[_appToken] != address(0), "Bad input");

        // Claim the rewards and transfer them to the user's wallet
        uint256 reward = IStaking(appTokenToStaking[_appToken]).earned(msg.sender);
        if (reward > 0) {
            IStaking(appTokenToStaking[_appToken]).claimReward(msg.sender);
            IERC20Upgradeable(_appToken).safeTransfer(msg.sender, reward);
        }
    }

    /**
     * @dev Allow app token owners to claim their app's Props rewards.
     * @param _appToken The app token to claim the rewards for
     */
    function claimAppPropsRewards(address _appToken) external {
        _requireNotPaused();
        require(appTokenToStaking[_appToken] != address(0), "Bad input");
        require(msg.sender == IOwnable(_appToken).owner(), "Unauthorized");

        // Claim the rewards and transfer them to the user's wallet
        uint256 reward = IStaking(sPropsAppStaking).earned(_appToken);
        if (reward > 0) {
            IStaking(sPropsAppStaking).claimReward(_appToken);
            IERC20Upgradeable(rPropsToken).safeTransfer(msg.sender, reward);
            // Since the rewards are in rProps, swap it for regular Props
            IRPropsToken(rPropsToken).swap(msg.sender);
        }
    }

    /**
     * @dev Allow app token owners to claim and directly stake their app's Props rewards.
     * @param _appToken The app token to claim and stake the rewards for
     */
    function claimAppPropsRewardsAndStake(address _appToken) external {
        _requireNotPaused();

        uint256 reward = IStaking(sPropsAppStaking).earned(_appToken);
        if (reward > 0) {
            IStaking(sPropsAppStaking).claimReward(_appToken);
            // Since the rewards are in rProps, swap it for regular Props
            IRPropsToken(rPropsToken).swap(address(this));

            address[] memory _appTokens = new address[](1);
            _appTokens[0] = _appToken;
            uint256[] memory _amounts = new uint256[](1);
            _amounts[0] = reward;

            this.stakeOnBehalf(_appTokens, _amounts, msg.sender);
        }
    }

    /**
     * @dev Allow users to claim their Props rewards.
     */
    function claimUserPropsRewards() external {
        _requireNotPaused();

        // Claim the rewards but don't transfer them to the user's wallet
        uint256 reward = IStaking(sPropsUserStaking).earned(msg.sender);
        if (reward > 0) {
            IStaking(sPropsUserStaking).claimReward(msg.sender);
            // Since the rewards are in rProps, swap it for regular Props
            IRPropsToken(rPropsToken).swap(address(this));

            // Place the rewards in the escrow and extend the cooldown period
            rewardsEscrow[msg.sender] = rewardsEscrow[msg.sender].add(reward);
            rewardsEscrowUnlock[msg.sender] = block.timestamp.add(rewardsEscrowCooldown);

            emit RewardsEscrowUpdated(
                msg.sender,
                rewardsEscrow[msg.sender],
                rewardsEscrowUnlock[msg.sender]
            );
        }
    }

    /**
     * @dev Allow users to claim and directly stake their Props rewards, without
     *      having the rewards go through the escrow (and thus having the cooldown
     *      period extended).
     * @param _appTokens Array of app tokens to stake to
     * @param _percentages Array of percentages of the claimed rewards to stake to each app token
     */
    function claimUserPropsRewardsAndStake(
        address[] calldata _appTokens,
        uint256[] calldata _percentages
    ) external {
        _requireNotPaused();

        _claimUserPropsRewardsAndStake(_appTokens, _percentages, msg.sender);
    }

    /**
     * @dev Claim and stake user Props rewards on behalf of a delegator account.
     * @param _appTokens Array of app tokens to stake to
     * @param _percentages Array of percentages of the claimed rewards to stake to each app token
     * @param _account Delegator to claim and stake on behalf of
     */
    function claimUserPropsRewardsAndStakeAsDelegate(
        address[] calldata _appTokens,
        uint256[] calldata _percentages,
        address _account
    ) external {
        _requireNotPaused();

        _claimUserPropsRewardsAndStake(_appTokens, _percentages, _account);
    }

    /**
     * @dev Allow users to unlock their escrowed Props rewards.
     */
    function unlockUserPropsRewards() external {
        _requireNotPaused();
        require(block.timestamp >= rewardsEscrowUnlock[msg.sender], "Unauthorized");

        if (rewardsEscrow[msg.sender] > 0) {
            // Empty the escrow
            uint256 escrowedRewards = rewardsEscrow[msg.sender];
            rewardsEscrow[msg.sender] = 0;

            // Transfer the rewards to the user's wallet
            IERC20Upgradeable(propsToken).safeTransfer(msg.sender, escrowedRewards);

            emit RewardsEscrowUpdated(msg.sender, 0, 0);
        }
    }

    /***************************************
                      ADMIN
    ****************************************/

    /**
     * @dev Set the app token factory contract.
     * @param _appTokenProxyFactory The address of the app token factory contract
     */
    function setAppTokenProxyFactory(address _appTokenProxyFactory) external {
        _requireOnlyOwner();
        require(appTokenProxyFactory == address(0));

        appTokenProxyFactory = _appTokenProxyFactory;
    }

    /**
     * @dev Set the rProps token contract.
     * @param _rPropsToken The address of the rProps token contract
     */
    function setRPropsToken(address _rPropsToken) external {
        _requireOnlyOwner();
        require(rPropsToken == address(0));

        rPropsToken = _rPropsToken;
    }

    /**
     * @dev Set the sProps token contract.
     * @param _sPropsToken The address of the sProps token contract
     */
    function setSPropsToken(address _sPropsToken) external {
        _requireOnlyOwner();
        require(sPropsToken == address(0));

        sPropsToken = _sPropsToken;
    }

    /**
     * @dev Set the sProps staking contract for app Props rewards.
     * @param _sPropsAppStaking The address of the sProps staking contract for app Props rewards
     */
    function setSPropsAppStaking(address _sPropsAppStaking) external {
        _requireOnlyOwner();
        require(sPropsAppStaking == address(0));

        sPropsAppStaking = _sPropsAppStaking;
    }

    /**
     * @dev Set the sProps staking contract for user Props rewards.
     * @param _sPropsUserStaking The address of the sProps staking contract for user Props rewards
     */
    function setSPropsUserStaking(address _sPropsUserStaking) external {
        _requireOnlyOwner();
        require(sPropsUserStaking == address(0));

        sPropsUserStaking = _sPropsUserStaking;
    }

    /**
     * @dev Pause the contract.
     */
    function pause() external {
        require(msg.sender == propsGuardian, "Unauthorized");
        paused = true;
    }

    /**
     * @dev Unpause the contract.
     */
    function unpause() external {
        require(msg.sender == propsGuardian, "Unauthorized");
        paused = false;
    }

    /**
     * @dev Set the cooldown for the escrowed rewards.
     * @param _rewardsEscrowCooldown The cooldown for the escrowed rewards
     */
    function setRewardsEscrowCooldown(uint256 _rewardsEscrowCooldown) external {
        _requireOnlyOwner();
        rewardsEscrowCooldown = _rewardsEscrowCooldown;
    }

    /**
     * @dev Whitelist an app token.
     * @param _appToken The address of the app token to whitelist
     */
    function whitelistAppToken(address _appToken) external {
        _requireOnlyOwner();

        appTokensWhitelist[_appToken] = 1;
        emit AppTokenWhitelisted(_appToken);
    }

    /**
     * @dev Blacklist an app token.
     * @param _appToken The address of the app token to blacklist
     */
    function blacklistAppToken(address _appToken) external {
        _requireOnlyOwner();

        appTokensWhitelist[_appToken] = 0;
        emit AppTokenBlacklisted(_appToken);
    }

    /**
     * @dev Distribute the rProps rewards to the sProps staking contracts for app and user rewards.
     *      This is a one time action only!
     * @param _appRewardsPercentage The percentage of minted rProps to go to the sProps staking contract for app rewards
     * @param _userRewardsPercentage The percentage of minted rProps to go to the sProps staking contract for user rewards
     */
    function distributePropsRewards(uint256 _appRewardsPercentage, uint256 _userRewardsPercentage)
        external
    {
        _requireOnlyOwner();
        IRPropsToken(rPropsToken).distributeRewards(
            sPropsAppStaking,
            _appRewardsPercentage,
            sPropsUserStaking,
            _userRewardsPercentage
        );
    }

    /***************************************
                     HELPERS
    ****************************************/

    function _stake(
        address[] memory _appTokens,
        int256[] memory _amounts,
        address _from,
        address _to,
        bool rewards
    ) internal {
        require(_appTokens.length == _amounts.length, "Bad input");

        // First, handle all unstakes (negative amounts)
        uint256 totalUnstakedAmount = 0;
        for (uint8 i = 0; i < _appTokens.length; i++) {
            require(appTokenToStaking[_appTokens[i]] != address(0), "Bad input");

            if (_amounts[i] < 0) {
                uint256 amountToUnstake = uint256(SignedSafeMathUpgradeable.mul(_amounts[i], -1));

                // Update user total staked amounts
                if (rewards) {
                    userRewardStakes[_to][_appTokens[i]] = userRewardStakes[_to][_appTokens[i]].sub(
                        amountToUnstake
                    );
                } else {
                    userStakes[_to][_appTokens[i]] = userStakes[_to][_appTokens[i]].sub(
                        amountToUnstake
                    );
                }

                // Unstake the Props from the app token staking contract
                IStaking(appTokenToStaking[_appTokens[i]]).withdraw(_to, amountToUnstake);

                // Unstake the sProps from the app sProps staking contract
                IStaking(sPropsAppStaking).withdraw(_appTokens[i], amountToUnstake);

                // Don't unstake the sProps from the user sProps staking contract since some
                // of them might get re-staked when handling the positive amounts (only unstake
                // the left amount at the end)

                // Update the total unstaked amount
                totalUnstakedAmount = totalUnstakedAmount.add(amountToUnstake);

                if (rewards) {
                    emit RewardsStake(_appTokens[i], _to, _amounts[i]);
                } else {
                    emit Stake(_appTokens[i], _to, _amounts[i]);
                }
            }
        }

        // Handle all stakes (positive amounts)
        for (uint256 i = 0; i < _appTokens.length; i++) {
            require(appTokensWhitelist[_appTokens[i]] != 0, "Blacklisted");

            if (_amounts[i] > 0) {
                uint256 amountToStake = uint256(_amounts[i]);

                // Update user total staked amounts
                if (rewards) {
                    userRewardStakes[_to][_appTokens[i]] = userRewardStakes[_to][_appTokens[i]].add(
                        amountToStake
                    );
                } else {
                    userStakes[_to][_appTokens[i]] = userStakes[_to][_appTokens[i]].add(
                        amountToStake
                    );
                }

                if (totalUnstakedAmount >= amountToStake) {
                    // If the previously unstaked amount can cover the stake then use that
                    totalUnstakedAmount = totalUnstakedAmount.sub(amountToStake);
                } else {
                    uint256 left = amountToStake.sub(totalUnstakedAmount);

                    if (rewards) {
                        // Otherwise, if we are handling the rewards, get the needed Props from escrow
                        rewardsEscrow[_from] = rewardsEscrow[_from].sub(left);
                    } else {
                        if (_from != address(this)) {
                            // When acting on behalf of a delegator no transfers are allowed
                            require(_from == msg.sender, "Unauthorized");

                            // Otherwise, if we are handling the principal, transfer the needed Props
                            IERC20Upgradeable(propsToken).safeTransferFrom(
                                _from,
                                address(this),
                                left
                            );
                        }
                    }

                    // Mint corresponding sProps
                    ISPropsToken(sPropsToken).mint(_to, left);

                    // Also stake the corresponding sProps in the user sProps staking contract
                    IStaking(sPropsUserStaking).stake(_to, left);

                    totalUnstakedAmount = 0;
                }

                // Stake the Props in the app token staking contract
                IStaking(appTokenToStaking[_appTokens[i]]).stake(_to, amountToStake);

                // Stake the sProps in the app sProps staking contract
                IStaking(sPropsAppStaking).stake(_appTokens[i], amountToStake);

                if (rewards) {
                    emit RewardsStake(_appTokens[i], _to, _amounts[i]);
                } else {
                    emit Stake(_appTokens[i], _to, _amounts[i]);
                }
            }
        }

        // If more tokens were unstaked than staked
        if (totalUnstakedAmount > 0) {
            // When acting on behalf of a delegator no withdraws are allowed
            require(_from == msg.sender, "Unauthorized");

            // Unstake the corresponding sProps from the user sProps staking contract
            IStaking(sPropsUserStaking).withdraw(_to, totalUnstakedAmount);

            if (rewards) {
                rewardsEscrow[_to] = rewardsEscrow[_to].add(totalUnstakedAmount);
                rewardsEscrowUnlock[_to] = block.timestamp.add(rewardsEscrowCooldown);

                emit RewardsEscrowUpdated(_to, rewardsEscrow[_to], rewardsEscrowUnlock[_to]);
            } else {
                // Transfer any left Props back to the user
                IERC20Upgradeable(propsToken).safeTransfer(_to, totalUnstakedAmount);
            }

            // Burn the sProps
            ISPropsToken(sPropsToken).burn(_to, totalUnstakedAmount);
        }
    }

    function _claimUserPropsRewardsAndStake(
        address[] memory _appTokens,
        uint256[] memory _percentages,
        address _account
    ) internal {
        if (_account != msg.sender) {
            require(delegates[_account] == msg.sender, "Unauthorized");
        }

        // Claim the rewards but don't transfer them to the user's wallet
        uint256 reward = IStaking(sPropsUserStaking).earned(_account);
        if (reward > 0) {
            IStaking(sPropsUserStaking).claimReward(_account);
            // Since the rewards are in rProps, swap it for regular Props
            IRPropsToken(rPropsToken).swap(address(this));

            // Place the rewards in the escrow but don't extend the cooldown period
            rewardsEscrow[_account] = rewardsEscrow[_account].add(reward);

            // Calculate amounts from the given percentages
            uint256 totalPercentage = 0;
            uint256 totalAmountSoFar = 0;
            int256[] memory amounts = new int256[](_percentages.length);
            for (uint8 i = 0; i < _percentages.length; i++) {
                if (i < _percentages.length.sub(1)) {
                    // Make sure nothing gets lost
                    amounts[i] = _safeInt256(reward.mul(_percentages[i]).div(1e6));
                } else {
                    amounts[i] = _safeInt256(reward.sub(totalAmountSoFar));
                }

                totalPercentage = totalPercentage.add(_percentages[i]);
                totalAmountSoFar = totalAmountSoFar.add(uint256(amounts[i]));
            }
            // Make sure the given percentages add up to 100%
            require(totalPercentage == 1e6, "Bad input");

            if (_account == msg.sender) {
                stakeRewards(_appTokens, amounts);
            } else {
                stakeRewardsAsDelegate(_appTokens, amounts, _account);
            }
        }
    }

    /***************************************
                    UTILITIES
    ****************************************/

    function _safeInt256(uint256 a) internal pure returns (int256) {
        require(a <= 2**255 - 1, "Overflow");
        return int256(a);
    }

    // Optimize the contract size by replacing modifiers (which get inlined and
    // generate a good amount of duplicated bytecode) with internal function calls
    // which are much more lightweight with regard to the generated bytecode size.

    function _requireNotPaused() internal view {
        require(!paused, "Paused");
    }

    function _requireOnlyOwner() internal view {
        require(msg.sender == owner(), "Unauthorized");
    }
}
