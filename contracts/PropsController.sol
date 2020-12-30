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
 * @dev The PropsController is the single entry point for participating
 *   in the Props protocol. It is responsible for deploying new app tokens
 *   and associated app token staking contracts and it also acts as a proxy
 *   for all staking-related operations. Staking, unstaking and claiming
 *   rewards are all executed through this contract. It works as a proxy
 *   to all app token staking contracts while also being the sole owner and
 *   thus the only one permissioned to call them. This contract is also the
 *   "sProps" token, which represents the total amount of staked Props of
 *   any given user. On every staking or unstaking operation, new sProps get
 *   minted. These sProps then get in turn staked in the app and user staking
 *   contracts, earning apps and users Props rewards.
 */
contract PropsController is Initializable, OwnableUpgradeable, MinimalProxyFactory, SPropsToken {
    using SafeMathUpgradeable for uint256;

    /// @dev The Props protocol treasury address
    address public propsTreasury;

    /// @dev The Props token contract
    address public propsToken;
    /// @dev The rProps token contract
    address public rPropsToken;

    /// @dev The app sProps staking contract
    address public sPropsAppStaking;
    /// @dev The user sProps staking contract
    address public sPropsUserStaking;

    /// @dev Logic contract for app token contract proxies
    address public appTokenImplementationContract;
    /// @dev Logic contract for app token staking contract proxies
    address public appTokenStakingImplementationContract;

    /// @dev List of all deployed app tokens
    address[] public appTokens;

    /// @dev Mapping from app token to the corresponding app token staking contract
    mapping(address => address) public appTokenToStaking;

    /// @dev Keeps track of the total amount of tokens staked to any particular app
    mapping(address => uint256) public appStakes;
    /// @dev Keeps track of the amount of tokens staked by an account to all apps
    mapping(address => mapping(address => uint256)) public userStakes;

    /// @dev Keeps track of all whitelisted app tokens
    mapping(address => uint8) public whitelist;

    event AppTokenDeployed(
        address indexed appTokenAddress,
        address indexed appTokenStakingAddress,
        string name,
        uint256 amount
    );
    event Staked(address indexed appToken, address indexed account, uint256 amount);
    event Withdrawn(address indexed appToken, address indexed account, uint256 amount);

    /**
     * @param _owner The owner of the contract
     * @param _propsTreasury The Props protocol treasury that a percentage of all minted app tokens will go to
     * @param _propsToken The Props token contract
     * @param _rPropsToken The rProps token contract
     * @param _sPropsAppStaking The sProps token contract used for app staking
     * @param _sPropsUserStaking The sProps token contract used for user staking
     * @param _appTokenImplementationContract The logic contract for app token contract proxies
     * @param _appTokenStakingImplementationContract The logic contract for app token staking contract proxies
     */
    function initialize(
        address _owner,
        address _propsTreasury,
        address _propsToken,
        address _rPropsToken,
        address _sPropsAppStaking,
        address _sPropsUserStaking,
        address _appTokenImplementationContract,
        address _appTokenStakingImplementationContract
    ) public initializer {
        OwnableUpgradeable.__Ownable_init();
        SPropsToken.__SPropsToken_init();

        // Set the proper owner
        if (_owner != msg.sender) {
            transferOwnership(_owner);
        }

        propsTreasury = _propsTreasury;

        propsToken = _propsToken;
        rPropsToken = _rPropsToken;

        sPropsAppStaking = _sPropsAppStaking;
        sPropsUserStaking = _sPropsUserStaking;

        appTokenImplementationContract = _appTokenImplementationContract;
        appTokenStakingImplementationContract = _appTokenStakingImplementationContract;
    }

    /// @dev Update the logic contract for app token contract proxies.
    function changeAppTokenImplementationContract(address _appTokenImplementationContract)
        external
        onlyOwner
    {
        appTokenImplementationContract = _appTokenImplementationContract;
    }

    /// @dev Update the logic contract for app token staking contract proxies.
    function changeAppTokenStakingImplementationContract(
        address _appTokenStakingImplementationContract
    ) external onlyOwner {
        appTokenStakingImplementationContract = _appTokenStakingImplementationContract;
    }

    /// @dev Whitelist an app token
    function whitelistAppToken(address _appToken) external onlyOwner {
        require(whitelist[_appToken] == 0, "App token already whitelisted");
        whitelist[_appToken] = 1;
    }

    /// @dev Blacklist an app token
    function blacklistAppToken(address _appToken) external onlyOwner {
        require(whitelist[_appToken] == 1, "App token already blacklisted");
        delete whitelist[_appToken];
    }

    /**
     * @dev Deploy a new app token.
     * @param _name The name of the app token
     * @param _symbol The symbol of the app token
     * @param _amount The initial amount of app tokens to be minted
     * @param _owner The owner of the app token
     * @param _dailyRewardsEmission The daily rewards emission parameter for the app token's staking contract
     * @return The address of the app token's proxy contract
     */
    function deployAppToken(
        string calldata _name,
        string calldata _symbol,
        uint256 _amount,
        address _owner,
        // TODO Ask if we really need this or just pass a hardcoded value
        uint256 _dailyRewardsEmission
    ) external returns (address) {
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
        address appTokenProxy = deployMinimal(appTokenImplementationContract, appTokenPayload);

        // Deploy the corresponding staking contract for the app token
        bytes memory appTokenStakingPayload =
            abi.encodeWithSignature(
                "initialize(address,address,address,address,uint256)",
                address(this),
                _owner,
                appTokenProxy,
                propsToken,
                _dailyRewardsEmission
            );
        address appTokenStakingProxy =
            deployMinimal(appTokenStakingImplementationContract, appTokenStakingPayload);

        // Save the address of the app token contract
        appTokens.push(appTokenProxy);
        // Associate the app token's staking contract with the app token
        appTokenToStaking[appTokenProxy] = appTokenStakingProxy;

        emit AppTokenDeployed(appTokenProxy, appTokenStakingProxy, _name, _amount);
        return appTokenProxy;
    }

    /**
     * @dev Stake on behalf of an account. It makes it possible to easily
     *   transfer a staking portofolio to someone else. The staked Props
     *   are transferred from the sender's account but staked on behalf of
     *   the requested account.
     * @param _appTokens Array of app tokens to stake to
     * @param _amounts Array of amounts to stake to each app token
     * @param _account Account to stake on behalf of
     */
    function stakeOnBehalf(
        address[] memory _appTokens,
        uint256[] memory _amounts,
        address _account
    ) public {
        require(_appTokens.length == _amounts.length, "Invalid lengths for the input arrays");

        for (uint8 i = 0; i < _appTokens.length; i++) {
            require(appTokenToStaking[_appTokens[i]] != address(0), "Invalid app token");
            require(whitelist[_appTokens[i]] == 1, "App token is not whitelisted");

            // Transfer Props and mint corresponding sProps
            IERC20Upgradeable(propsToken).transferFrom(msg.sender, address(this), _amounts[i]);
            mint(_account, _amounts[i]);

            // Stake the Props in the app token staking contract
            IERC20Upgradeable(propsToken).approve(appTokenToStaking[_appTokens[i]], _amounts[i]);
            IStaking(appTokenToStaking[_appTokens[i]]).stake(_account, _amounts[i]);

            // Stake the sProps in the app and user sProps staking contracts
            IStaking(sPropsAppStaking).stake(_appTokens[i], _amounts[i]);
            IStaking(sPropsUserStaking).stake(_account, _amounts[i]);

            // Update app and user total staked amounts
            appStakes[_appTokens[i]] = appStakes[_appTokens[i]].add(_amounts[i]);
            userStakes[_account][_appTokens[i]] = userStakes[_account][_appTokens[i]].add(
                _amounts[i]
            );

            emit Staked(_appTokens[i], _account, _amounts[i]);
        }
    }

    /// @dev Use an off-chain signature to approve and stake on behalf in the same transaction
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
     *   staking to and unstaking from app tokens. It accepts both positive
     *   and negative amounts, which represent an adjustment to the staked
     *   amount to the corresponding app token.
     * @param _appTokens Array of app tokens to stake/unstake to/from
     * @param _amounts Array of amounts to stake/unstake to/from each app token
     */
    function stake(address[] memory _appTokens, int256[] memory _amounts) public {
        require(_appTokens.length == _amounts.length, "Invalid lengths for the input arrays");

        // First, handle all unstakes (negative amounts)
        uint256 totalUnstakedAmount = 0;
        for (uint8 i = 0; i < _appTokens.length; i++) {
            require(appTokenToStaking[_appTokens[i]] != address(0), "Invalid app token");
            require(whitelist[_appTokens[i]] == 1, "App token is not whitelisted");

            if (_amounts[i] < 0) {
                uint256 amountToUnstake = uint256(SignedSafeMathUpgradeable.mul(_amounts[i], -1));

                // Unstake the Props from the app token staking contract
                IStaking(appTokenToStaking[_appTokens[i]]).withdraw(msg.sender, amountToUnstake);

                // Unstake the sProps from the app sProps staking contract
                IStaking(sPropsAppStaking).withdraw(_appTokens[i], amountToUnstake);

                // Don't unstake the sProps from the user sProps staking contract since some
                // of them will anyway get re-staked when handling the positive amounts

                // Update app and user total staked amounts
                appStakes[_appTokens[i]] = appStakes[_appTokens[i]].sub(amountToUnstake);
                userStakes[msg.sender][_appTokens[i]] = userStakes[msg.sender][_appTokens[i]].sub(
                    amountToUnstake
                );

                // Update the total unstaked amount
                totalUnstakedAmount = totalUnstakedAmount.add(amountToUnstake);

                emit Withdrawn(_appTokens[i], msg.sender, amountToUnstake);
            }
        }

        // Handle all stakes (positive amounts)
        for (uint256 i = 0; i < _appTokens.length; i++) {
            if (_amounts[i] > 0) {
                uint256 amountToStake = uint256(_amounts[i]);

                if (totalUnstakedAmount >= amountToStake) {
                    // If the previously unstaked amount can cover the stake then use that
                    totalUnstakedAmount = totalUnstakedAmount.sub(amountToStake);
                } else {
                    uint256 left = amountToStake.sub(totalUnstakedAmount);

                    // Otherwise transfer the needed Props and mint user sProps
                    IERC20Upgradeable(propsToken).transferFrom(msg.sender, address(this), left);
                    mint(msg.sender, left);

                    // Also stake the corresponding sProps in the user sProps staking contract
                    IStaking(sPropsUserStaking).stake(msg.sender, left);

                    totalUnstakedAmount = 0;
                }

                // Stake the Props in the app token staking contract
                IERC20Upgradeable(propsToken).approve(
                    appTokenToStaking[_appTokens[i]],
                    amountToStake
                );
                IStaking(appTokenToStaking[_appTokens[i]]).stake(msg.sender, amountToStake);

                // Stake the sProps in the app sProps staking contract
                IStaking(sPropsAppStaking).stake(_appTokens[i], amountToStake);

                // Update app and user total staked amounts
                appStakes[_appTokens[i]] = appStakes[_appTokens[i]].add(amountToStake);
                userStakes[msg.sender][_appTokens[i]] = userStakes[msg.sender][_appTokens[i]].add(
                    amountToStake
                );

                emit Staked(_appTokens[i], msg.sender, amountToStake);
            }
        }

        // If more tokens were unstaked than staked
        if (totalUnstakedAmount > 0) {
            // Transfer any left Props back to the user
            IERC20Upgradeable(propsToken).transfer(msg.sender, totalUnstakedAmount);
            // Unstake the corresponding sProps from the user sProps staking contract
            IStaking(sPropsUserStaking).withdraw(msg.sender, totalUnstakedAmount);
            // Burn the sProps
            burn(msg.sender, totalUnstakedAmount);
        }
    }

    /// @dev Use an off-chain signature to approve and stake in the same transaction
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
     * @dev Allow users to claim their app token rewards
     * @param _appToken The app token to claim the rewards for
     */
    function claimUserAppTokenRewards(address _appToken) external {
        require(appTokenToStaking[_appToken] != address(0), "Invalid app token");
        require(whitelist[_appToken] == 1, "App token is not whitelisted");

        IStaking(appTokenToStaking[_appToken]).getReward(msg.sender);
    }

    /**
     * @dev Allow app token owners to claim the Props app rewards.
     * @param _appToken The app token to claim the rewards for
     */
    function claimAppPropsRewards(address _appToken) external {
        address appTokenOwner = OwnableUpgradeable(_appToken).owner();

        require(appTokenToStaking[_appToken] != address(0), "Invalid app token");
        require(whitelist[_appToken] == 1, "App token is not whitelisted");
        require(msg.sender == appTokenOwner, "Only app token owner's can claim rewards");

        // Claim the rProps rewards
        uint256 reward = IStaking(sPropsAppStaking).earned(_appToken);
        IStaking(sPropsAppStaking).getReward(_appToken);
        // Transfer the rProps to the app token owner
        IERC20Upgradeable(rPropsToken).transfer(appTokenOwner, reward);
        // Swap the rProps for regular Props
        IRPropsToken(rPropsToken).swap(appTokenOwner);
    }

    function claimUserPropsRewards() external {
        // TODO Put into escrow instead of transferring to user

        // Claim the rProps rewards
        uint256 reward = IStaking(sPropsUserStaking).earned(msg.sender);
        IStaking(sPropsUserStaking).getReward(msg.sender);
        // Transfer the rProps to the user
        IERC20Upgradeable(rPropsToken).transfer(msg.sender, reward);
        // Swap the rProps for regular Props
        IRPropsToken(rPropsToken).swap(msg.sender);
    }
}
