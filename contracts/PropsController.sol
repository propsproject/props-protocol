// SPDX-License-Identifier: MIT
pragma solidity ^0.6.0;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/math/SignedSafeMathUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";

import "./MinimalProxyFactory.sol";
import "./interfaces/IPropsToken.sol";
import "./interfaces/IRPropsToken.sol";
import "./interfaces/IStaking.sol";
import "./tokens/SPropsToken.sol";

/**
 * @title  PropsController
 * @author Props
 * @notice Entry point for participating in the Props protocol. All actions should
 *         be done exclusively through this contract.
 * @dev    It is responsible for proxying staking-related actions to the appropiate
 *         app token staking contracts. Moreover, it is the sProps ERC20 token, and
 *         it also handles sProps minting/burning and staking, swapping earned rProps
 *         for regular Props and locking users rProps rewards.
 */
contract PropsController is Initializable, OwnableUpgradeable, MinimalProxyFactory, SPropsToken {
    using SafeMathUpgradeable for uint256;

    // The Props protocol treasury address
    address public propsTreasury;

    address public propsToken;
    address public rPropsToken;

    // The sProps staking contract for app Props rewards
    address public sPropsAppStaking;
    // The sProps staking contract for user Props rewards
    address public sPropsUserStaking;

    // Logic contract for app token contract proxies
    address public appTokenLogic;
    // Logic contract for app token staking contract proxies
    address public appTokenStakingLogic;

    // List of all existing app tokens
    address[] public appTokens;
    // Mapping of the app token staking contract of each app token
    mapping(address => address) public appTokenToStaking;

    // Mapping of the total amount staked to each app token
    mapping(address => uint256) public appStakes;
    // Mapping of the total amount staked of each user across all app tokens
    mapping(address => mapping(address => uint256)) public userStakes;
    // Mapping of the total locked rewards amount staked of each user across all app tokens
    mapping(address => mapping(address => uint256)) public userRewardStakes;

    // Mapping of the total amount of escrowed rewards of each user
    mapping(address => uint256) public rewardsEscrow;
    // Mapping of the unlock time for the escrowed rewards of each user
    mapping(address => uint256) public rewardsEscrowUnlock;

    // The cooldown period for the rewards escrow
    uint256 public rewardsEscrowCooldown;

    // Set of whitelisted app tokens
    mapping(address => uint8) public appTokensWhitelist;

    event AppTokenDeployed(
        address indexed appToken,
        address indexed appTokenStaking,
        string name,
        uint256 amount
    );
    event Staked(address indexed appToken, address indexed account, uint256 amount);
    event Withdrawn(address indexed appToken, address indexed account, uint256 amount);

    /***************************************
                   INITIALIZER
    ****************************************/

    /**
     * @dev Initializer.
     * @param _owner The owner of the contract
     * @param _propsTreasury The Props protocol treasury that a percentage of all minted app tokens will go to
     * @param _propsToken The Props token contract
     * @param _appTokenLogic The logic contract for app token contract proxies
     * @param _appTokenStakingLogic The logic contract for app token staking contract proxies
     */
    function initialize(
        address _owner,
        address _propsTreasury,
        address _propsToken,
        address _appTokenLogic,
        address _appTokenStakingLogic
    ) public initializer {
        OwnableUpgradeable.__Ownable_init();
        SPropsToken.__SPropsToken_init();

        if (_owner != msg.sender) {
            transferOwnership(_owner);
        }

        propsTreasury = _propsTreasury;

        propsToken = _propsToken;

        appTokenLogic = _appTokenLogic;
        appTokenStakingLogic = _appTokenStakingLogic;

        // TODO Decide on the final cooldown period
        rewardsEscrowCooldown = 90 days;
    }

    /***************************************
                     GETTERS
    ****************************************/

    /// @dev Get the app token at a specific index.
    function getAppToken(uint256 _index) external view returns (address) {
        require(_index < appTokens.length, "Invalid index");
        return appTokens[_index];
    }

    /// @dev Get the total number of deployed app tokens.
    function getAppTokensCount() external view returns (uint256) {
        return appTokens.length;
    }

    /***************************************
                     ACTIONS
    ****************************************/

    /**
     * @dev Deploy a new app token.
     * @param _name The name of the app token
     * @param _symbol The symbol of the app token
     * @param _amount The initial amount of app tokens to be minted
     * @param _owner The owner of the app token
     * @param _dailyRewardEmission The daily reward emission parameter for the app token's staking contract
     * @return The address of the just deployed app token
     */
    function deployAppToken(
        string calldata _name,
        string calldata _symbol,
        uint256 _amount,
        address _owner,
        uint256 _dailyRewardEmission
    ) external returns (address) {
        // In order to reduce gas costs, the minimal proxy pattern is used when creating new app tokens

        // Deploy the app token contract
        bytes memory appTokenPayload =
            abi.encodeWithSignature(
                "initialize(string,string,uint256,address,address)",
                _name,
                _symbol,
                _amount,
                _owner,
                propsTreasury
            );
        address appTokenProxy = deployMinimal(appTokenLogic, appTokenPayload);

        // Deploy the corresponding staking contract for the app token
        bytes memory appTokenStakingPayload =
            abi.encodeWithSignature(
                "initialize(address,address,address,address,uint256)",
                address(this),
                _owner,
                appTokenProxy,
                propsToken,
                _dailyRewardEmission
            );
        address appTokenStakingProxy = deployMinimal(appTokenStakingLogic, appTokenStakingPayload);

        // Save the app token and its corresponding staking contract
        appTokens.push(appTokenProxy);
        appTokenToStaking[appTokenProxy] = appTokenStakingProxy;

        emit AppTokenDeployed(appTokenProxy, appTokenStakingProxy, _name, _amount);
        return appTokenProxy;
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
        // Convert from uint256 to int256
        int256[] memory amounts = new int256[](_amounts.length);
        for (uint8 i = 0; i < _amounts.length; i++) {
            amounts[i] = _safeInt256(_amounts[i]);
        }

        _stake(_appTokens, amounts, _account, false);
    }

    /// @dev Use an off-chain signature to approve and stake on behalf in the same transaction.
    function stakeOnBehalfBySig(
        address[] calldata _appTokens,
        uint256[] calldata _amounts,
        address _account,
        address _owner,
        address _spender,
        uint256 _amount,
        uint256 _deadline,
        uint8 _v,
        bytes32 _r,
        bytes32 _s
    ) external {
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
        _stake(_appTokens, _amounts, msg.sender, false);
    }

    /// @dev Use an off-chain signature to approve and stake in the same transaction.
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
        IPropsToken(propsToken).permit(_owner, _spender, _amount, _deadline, _v, _r, _s);
        stake(_appTokens, _amounts);
    }

    /**
     * @dev Similar to `stake`, this function is used to stake/unstake to/from
     *      app tokens. The only difference is that it uses the escrowed
     *      rewards instead of transferring from the user's wallet.
     * @param _appTokens Array of app tokens to stake/unstake to/from
     * @param _amounts Array of amounts to stake/unstake to/from each app token
     */
    function stakeRewards(address[] memory _appTokens, int256[] memory _amounts) public {
        _stake(_appTokens, _amounts, msg.sender, true);
    }

    /**
     * @dev Allow users to claim their app token rewards.
     * @param _appToken The app token to claim the rewards for
     */
    function claimAppTokenRewards(address _appToken) external {
        require(appTokenToStaking[_appToken] != address(0), "Invalid app token");

        // Claim the rewards and transfer them to the user's wallet
        uint256 reward = IStaking(appTokenToStaking[_appToken]).earned(msg.sender);
        IStaking(appTokenToStaking[_appToken]).claimReward(msg.sender);
        IERC20Upgradeable(_appToken).transfer(msg.sender, reward);
    }

    /**
     * @dev Allow app token owners to claim their app's Props rewards.
     * @param _appToken The app token to claim the rewards for
     */
    function claimAppPropsRewards(address _appToken) external {
        require(appTokenToStaking[_appToken] != address(0), "Invalid app token");
        require(
            msg.sender == OwnableUpgradeable(_appToken).owner(),
            "Only the app token owner can claim app rewards"
        );

        // Claim the rewards and transfer them to the user's wallet
        uint256 reward = IStaking(sPropsAppStaking).earned(_appToken);
        IStaking(sPropsAppStaking).claimReward(_appToken);
        IERC20Upgradeable(rPropsToken).transfer(msg.sender, reward);
        // Since the rewards are in rProps, swap it for regular Props
        IRPropsToken(rPropsToken).swap(msg.sender);
    }

    /// @dev Allow users to claim their Props rewards.
    function claimUserPropsRewards() external {
        // Claim the rewards but don't transfer them to the user's wallet
        uint256 reward = IStaking(sPropsUserStaking).earned(msg.sender);
        IStaking(sPropsUserStaking).claimReward(msg.sender);
        // Since the rewards are in rProps, swap it for regular Props
        IRPropsToken(rPropsToken).swap(address(this));

        // Place the rewards in the escrow and extend the cooldown period
        rewardsEscrow[msg.sender] = rewardsEscrow[msg.sender].add(reward);
        rewardsEscrowUnlock[msg.sender] = block.timestamp.add(rewardsEscrowCooldown);
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
        // Claim the rewards but don't transfer them to the user's wallet
        uint256 reward = IStaking(sPropsUserStaking).earned(msg.sender);
        IStaking(sPropsUserStaking).claimReward(msg.sender);
        // Since the rewards are in rProps, swap it for regular Props
        IRPropsToken(rPropsToken).swap(address(this));

        // Place the rewards in the escrow but don't extend the cooldown period
        rewardsEscrow[msg.sender] = rewardsEscrow[msg.sender].add(reward);

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
        require(totalPercentage == 1e6, "Invalid percentages");

        stakeRewards(_appTokens, amounts);
    }

    /// @dev Allow users to unlock their escrowed Props rewards.
    function unlockUserPropsRewards() external {
        require(
            block.timestamp >= rewardsEscrowUnlock[msg.sender],
            "Rewards are still in cooldown"
        );

        // Empty the escrow
        uint256 escrowedRewards = rewardsEscrow[msg.sender];
        rewardsEscrow[msg.sender] = 0;

        // Transfer the rewards to the user's wallet
        IERC20Upgradeable(propsToken).transfer(msg.sender, escrowedRewards);
    }

    /***************************************
                      ADMIN
    ****************************************/

    /**
     * @dev Set the rProps token contract.
     * @param _rPropsToken The address of the rProps token contract
     */
    function setRPropsToken(address _rPropsToken) external onlyOwner {
        require(rPropsToken == address(0), "Already set");
        rPropsToken = _rPropsToken;
    }

    /**
     * @dev Set the sProps staking contract for app Props rewards.
     * @param _sPropsAppStaking The address of the sProps staking contract for app Props rewards
     */
    function setSPropsAppStaking(address _sPropsAppStaking) external onlyOwner {
        require(sPropsAppStaking == address(0), "Already set");
        sPropsAppStaking = _sPropsAppStaking;
    }

    /**
     * @dev Set the sProps staking contract for user Props rewards.
     * @param _sPropsUserStaking The address of the sProps staking contract for user Props rewards
     */
    function setSPropsUserStaking(address _sPropsUserStaking) external onlyOwner {
        require(sPropsUserStaking == address(0), "Already set");
        sPropsUserStaking = _sPropsUserStaking;
    }

    /**
     * @dev Set the cooldown for the escrowed rewards.
     * @param _rewardsEscrowCooldown The cooldown for the escrowed rewards
     */
    function setRewardsEscrowCooldown(uint256 _rewardsEscrowCooldown) external onlyOwner {
        rewardsEscrowCooldown = _rewardsEscrowCooldown;
    }

    /**
     * @dev Set the logic contract for app token contract proxies.
     * @param _appTokenLogic The address of the new logic contract
     */
    function setAppTokenLogic(address _appTokenLogic) external onlyOwner {
        appTokenLogic = _appTokenLogic;
    }

    /**
     * @dev Set the logic contract for app token staking contract proxies.
     * @param _appTokenStakingLogic The address of the new logic contract
     */
    function setAppTokenStakingLogic(address _appTokenStakingLogic) external onlyOwner {
        appTokenStakingLogic = _appTokenStakingLogic;
    }

    /**
     * @dev Whitelist an app token.
     * @param _appToken The address of the app token to whitelist
     */
    function whitelistAppToken(address _appToken) external onlyOwner {
        require(appTokensWhitelist[_appToken] == 0, "App token already whitelisted");
        appTokensWhitelist[_appToken] = 1;
    }

    /**
     * @dev Blacklist an app token.
     * @param _appToken The address of the app token to blacklist
     */
    function blacklistAppToken(address _appToken) external onlyOwner {
        require(appTokensWhitelist[_appToken] != 0, "App token already blacklisted");
        appTokensWhitelist[_appToken] = 0;
    }

    /**
     * @dev Distribute the rProps rewards to the sProps staking contracts for app and user rewards.
     * @param _appRewardsPercentage The percentage of minted rProps to go to the sProps staking contract for app rewards
     * @param _userRewardsPercentage The percentage of minted rProps to go to the sProps staking contract for user rewards
     */
    function distributePropsRewards(uint256 _appRewardsPercentage, uint256 _userRewardsPercentage)
        external
        onlyOwner
    {
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
        address _to,
        bool rewards
    ) internal {
        require(_appTokens.length == _amounts.length, "Invalid lengths for the input arrays");

        // First, handle all unstakes (negative amounts)
        uint256 totalUnstakedAmount = 0;
        for (uint8 i = 0; i < _appTokens.length; i++) {
            require(appTokenToStaking[_appTokens[i]] != address(0), "Invalid app token");

            if (_amounts[i] < 0) {
                uint256 amountToUnstake = uint256(SignedSafeMathUpgradeable.mul(_amounts[i], -1));

                // Update app and user total staked amounts
                appStakes[_appTokens[i]] = appStakes[_appTokens[i]].sub(amountToUnstake);
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

                emit Withdrawn(_appTokens[i], _to, amountToUnstake);
            }
        }

        // Handle all stakes (positive amounts)
        for (uint256 i = 0; i < _appTokens.length; i++) {
            require(appTokensWhitelist[_appTokens[i]] != 0, "App token is blacklisted");

            if (_amounts[i] > 0) {
                uint256 amountToStake = uint256(_amounts[i]);

                if (totalUnstakedAmount >= amountToStake) {
                    // If the previously unstaked amount can cover the stake then use that
                    totalUnstakedAmount = totalUnstakedAmount.sub(amountToStake);
                } else {
                    uint256 left = amountToStake.sub(totalUnstakedAmount);

                    if (rewards) {
                        // Otherwise, if we are handling the rewards, get the needed Props from escrow
                        rewardsEscrow[msg.sender] = rewardsEscrow[msg.sender].sub(left);
                    } else {
                        // Otherwise, if we are handling the principal, transfer the needed Props
                        IERC20Upgradeable(propsToken).transferFrom(msg.sender, address(this), left);
                    }

                    // Mint corresponding sProps
                    mint(_to, left);

                    // Also stake the corresponding sProps in the user sProps staking contract
                    IStaking(sPropsUserStaking).stake(_to, left);

                    totalUnstakedAmount = 0;
                }

                // Stake the Props in the app token staking contract
                IStaking(appTokenToStaking[_appTokens[i]]).stake(_to, amountToStake);

                // Stake the sProps in the app sProps staking contract
                IStaking(sPropsAppStaking).stake(_appTokens[i], amountToStake);

                // Update app and user total staked amounts
                appStakes[_appTokens[i]] = appStakes[_appTokens[i]].add(amountToStake);
                if (rewards) {
                    userRewardStakes[_to][_appTokens[i]] = userRewardStakes[_to][_appTokens[i]].add(
                        amountToStake
                    );
                } else {
                    userStakes[_to][_appTokens[i]] = userStakes[_to][_appTokens[i]].add(
                        amountToStake
                    );
                }

                emit Staked(_appTokens[i], _to, amountToStake);
            }
        }

        // If more tokens were unstaked than staked
        if (totalUnstakedAmount > 0) {
            // Unstake the corresponding sProps from the user sProps staking contract
            IStaking(sPropsUserStaking).withdraw(_to, totalUnstakedAmount);

            if (rewards) {
                rewardsEscrow[_to] = rewardsEscrow[_to].add(totalUnstakedAmount);
                rewardsEscrowUnlock[_to] = block.timestamp.add(rewardsEscrowCooldown);
            } else {
                // Transfer any left Props back to the user
                IERC20Upgradeable(propsToken).transfer(_to, totalUnstakedAmount);
            }

            // Burn the sProps
            burn(_to, totalUnstakedAmount);
        }
    }

    function _safeInt256(uint256 a) internal pure returns (int256) {
        require(a <= 2**255 - 1, "Overflow");
        return int256(a);
    }
}
