// SPDX-License-Identifier: MIT
pragma solidity ^0.6.0;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/math/SafeMathUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/math/SignedSafeMathUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/Initializable.sol";

import "../interfaces/IPropsToken.sol";
import "../interfaces/IRPropsToken.sol";
import "../interfaces/IStaking.sol";
import "../tokens/SPropsToken.sol";

/**
 * @dev The StakingManager is responsible for all staking-related operations.
 *   Staking, unstaking and claiming rewards are all executed through this
 *   contract. It acts as a proxy to all app token staking contracts while
 *   also being the sole owner and thus the only one permissioned to call
 *   them. The StakingManager is also the "sProps" token, which represents
 *   the total amount of staked Props of any given user. On every staking
 *   or unstaking operation, new sProps get minted. These sProps then get
 *   in turn staked in the app and user staking contracts, earning apps and
 *   users Props rewards.
 */
abstract contract StakingManager is Initializable, SPropsToken {
    using SafeMathUpgradeable for uint256;

    /// @dev The Props token contract
    address public propsToken;
    /// @dev The rProps token contract
    address public rPropsToken;

    /// @dev The app sProps staking contract
    IStaking public sPropsAppStaking;
    /// @dev The user sProps staking contract
    IStaking public sPropsUserStaking;

    /// @dev Mapping from app token to the corresponding app token staking contract
    mapping(address => IStaking) public appTokenToStaking;

    /// @dev Keeps track of the total amount of tokens staked to any particular app
    mapping(address => uint256) public appStakes;
    /// @dev Keeps track of the amount of tokens staked by an account to all apps
    mapping(address => mapping(address => uint256)) public userStakes;

    event Staked(address indexed appToken, address indexed account, uint256 amount);
    event Withdrawn(address indexed appToken, address indexed account, uint256 amount);

    // solhint-disable-next-line func-name-mixedcase
    function __StakingManager_init(
        address _propsToken,
        address _rPropsToken,
        address _sPropsAppStaking,
        address _sPropsUserStaking
    ) public initializer {
        SPropsToken.__SPropsToken_init();

        propsToken = _propsToken;
        rPropsToken = _rPropsToken;
        sPropsAppStaking = IStaking(_sPropsAppStaking);
        sPropsUserStaking = IStaking(_sPropsUserStaking);
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
            require(address(appTokenToStaking[_appTokens[i]]) != address(0), "Invalid app token");

            // Transfer Props and mint corresponding sProps
            IERC20Upgradeable(propsToken).transferFrom(msg.sender, address(this), _amounts[i]);
            super.mint(_account, _amounts[i]);

            // Stake the Props in the app token staking contract
            IERC20Upgradeable(propsToken).approve(
                address(appTokenToStaking[_appTokens[i]]),
                _amounts[i]
            );
            appTokenToStaking[_appTokens[i]].stake(_account, _amounts[i]);

            // Stake the sProps in the app and user sProps staking contracts
            sPropsAppStaking.stake(_appTokens[i], _amounts[i]);
            sPropsUserStaking.stake(_account, _amounts[i]);

            // Update app and user total staked amounts
            appStakes[_appTokens[i]] = appStakes[_appTokens[i]].add(_amounts[i]);
            userStakes[_account][_appTokens[i]] = userStakes[_account][_appTokens[i]].add(
                _amounts[i]
            );

            emit Staked(_appTokens[i], _account, _amounts[i]);
        }
    }

    /// @dev Use an off-chain signature to approve and stake in the same transaction
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
            require(address(appTokenToStaking[_appTokens[i]]) != address(0), "Invalid app token");

            if (_amounts[i] < 0) {
                uint256 amountToUnstake = uint256(SignedSafeMathUpgradeable.mul(_amounts[i], -1));

                // Unstake the Props from the app token staking contract
                appTokenToStaking[_appTokens[i]].withdraw(msg.sender, amountToUnstake);

                // Unstake the sProps from the app sProps staking contract
                sPropsAppStaking.withdraw(_appTokens[i], amountToUnstake);

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
                    super.mint(msg.sender, left);

                    // Also stake the corresponding sProps in the user sProps staking contract
                    sPropsUserStaking.stake(msg.sender, left);

                    totalUnstakedAmount = 0;
                }

                // Stake the Props in the app token staking contract
                IERC20Upgradeable(propsToken).approve(
                    address(appTokenToStaking[_appTokens[i]]),
                    amountToStake
                );
                appTokenToStaking[_appTokens[i]].stake(msg.sender, amountToStake);

                // Stake the sProps in the app sProps staking contract
                sPropsAppStaking.stake(_appTokens[i], amountToStake);

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
            sPropsUserStaking.withdraw(msg.sender, totalUnstakedAmount);
            // Burn the sProps
            super.burn(msg.sender, totalUnstakedAmount);
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

    function claimAppRewards(address _appToken) external {
        require(address(appTokenToStaking[_appToken]) != address(0), "Invalid app token");
        require(msg.sender == OwnableUpgradeable(_appToken).owner(), "Only app token owner's can claim rewards");

        uint256 reward = appTokenToStaking[_appToken].earned(_appToken);
        appTokenToStaking[_appToken].getReward(_appToken);
        IERC20Upgradeable(rPropsToken).transfer(OwnableUpgradeable(_appToken).owner(), reward);
        IRPropsToken(rPropsToken).swap(OwnableUpgradeable(_appToken).owner());
    }

    /// @dev Used for associating an app token with its staking contract
    function saveAppToken(address _appToken, address _appTokenStaking) internal {
        appTokenToStaking[_appToken] = IStaking(_appTokenStaking);
    }
}
