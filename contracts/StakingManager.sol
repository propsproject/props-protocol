// SPDX-License-Identifier: MIT
pragma solidity ^0.6.0;

import "@openzeppelin/contracts-upgradeable/math/SafeMathUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/math/SignedSafeMathUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";

import "./SPropsAppToken.sol";
import "./SPropsUserToken.sol";
import "./staking/AppTokenStaking.sol";

contract StakingManager is Initializable {
    using SafeMathUpgradeable for uint256;

    IERC20Upgradeable public propsToken;
    SPropsAppToken public sPropsAppToken;
    SPropsUserToken public sPropsUserToken;

    mapping(address => uint256) public appStakes;
    mapping(address => mapping(address => uint256)) public userStakes;

    mapping(address => AppTokenStaking) public appTokenToStaking;

    function stakingManagerInitialize(address _propsToken) public initializer {
        propsToken = IERC20Upgradeable(_propsToken);

        // TODO deploy upgradeable proxy
        sPropsAppToken = new SPropsAppToken();
        sPropsAppToken.initialize();

        // TODO deploy upgradeable proxy
        sPropsUserToken = new SPropsUserToken();
        sPropsUserToken.initialize();
    }

    function saveAppToken(address appToken, address appTokenStaking) internal {
        require(address(appTokenToStaking[appToken]) == address(0), "App token already saved");
        appTokenToStaking[appToken] = AppTokenStaking(appTokenStaking);
    }

    function stakeOnBehalf(
        address[] calldata _appTokens,
        uint256[] calldata _amounts,
        address _account
    ) external {
        require(_appTokens.length == _amounts.length, "Arity mismatch");

        for (uint256 i = 0; i < _appTokens.length; i++) {
            require(address(appTokenToStaking[_appTokens[i]]) != address(0), "Invalid app token");

            // Update app and user total staked amounts
            appStakes[_appTokens[i]] = appStakes[_appTokens[i]].add(_amounts[i]);
            userStakes[_account][_appTokens[i]] = userStakes[_account][_appTokens[i]].add(_amounts[i]);

            // Transfer Props and mint app sProps and user sProps
            propsToken.transferFrom(msg.sender, address(this), _amounts[i]);
            sPropsAppToken.mint(_appTokens[i], _amounts[i]);
            sPropsUserToken.mint(_account, _amounts[i]);

            // Stake the Props in the app token staking contract
            AppTokenStaking appTokenStaking = appTokenToStaking[_appTokens[i]];
            propsToken.approve(address(appTokenStaking), _amounts[i]);
            appTokenStaking.stake(_account, _amounts[i]);

            // TODO Stake the app sProps in the app sProps staking contract

            // TODO Stake the user sProps in the user sProps staking contract
        }
    }

    function stake(address[] calldata _appTokens, int256[] calldata _amounts) external {
        require(_appTokens.length == _amounts.length, "Arity mismatch");

        // First, handle all unstakes (negative amounts)
        uint256 unstakedAmount = 0;
        for (uint256 i = 0; i < _appTokens.length; i++) {
            require(address(appTokenToStaking[_appTokens[i]]) != address(0), "Invalid app token");

            if (_amounts[i] < 0) {
                uint256 amountToUnstake = uint256(SignedSafeMathUpgradeable.mul(_amounts[i], -1));

                // Update app and user total staked amounts
                appStakes[_appTokens[i]] = appStakes[_appTokens[i]].sub(amountToUnstake);
                userStakes[msg.sender][_appTokens[i]] =
                    userStakes[msg.sender][_appTokens[i]].sub(amountToUnstake);

                // Unstake the Props from the app token staking contract
                AppTokenStaking appTokenStaking = appTokenToStaking[_appTokens[i]];
                appTokenStaking.withdraw(msg.sender, amountToUnstake);

                // TODO Unstake the app sProps in the app sProps staking contract

                // TODO Unstake the user sProps in the user sProps staking contract

                // Burn app sProps and user sProps
                sPropsAppToken.burn(_appTokens[i], amountToUnstake);
                sPropsUserToken.burn(msg.sender, amountToUnstake);

                // Update the total unstaked amount
                unstakedAmount = unstakedAmount.add(amountToUnstake);
            }
        }

        // Handle all stakes (positive amounts)
        for (uint256 i = 0; i < _appTokens.length; i++) {
            if (_amounts[i] > 0) {
                uint256 amountToStake = uint256(_amounts[i]);

                // Update app and user total staked amounts
                appStakes[_appTokens[i]] = appStakes[_appTokens[i]].add(amountToStake);
                userStakes[msg.sender][_appTokens[i]] =
                    userStakes[msg.sender][_appTokens[i]].add(amountToStake);

                if (unstakedAmount >= amountToStake) {
                    // If the previously unstaked amount can cover the stake the use that
                    unstakedAmount = unstakedAmount.sub(amountToStake);
                } else {
                    // Otherwise transfer the needed Props and mint app sProps and user sProps
                    propsToken.transferFrom(msg.sender, address(this), amountToStake.sub(unstakedAmount));
                    unstakedAmount = 0;
                }

                // Mint app sProps and user sProps
                sPropsAppToken.mint(_appTokens[i], amountToStake);
                sPropsUserToken.mint(msg.sender, amountToStake);

                // Stake the Props in the app token staking contract
                AppTokenStaking appTokenStaking = appTokenToStaking[_appTokens[i]];
                propsToken.approve(address(appTokenStaking), amountToStake);
                appTokenStaking.stake(msg.sender, amountToStake);

                // TODO Stake the app sProps in the app sProps staking contract

                // TODO Stake the user sProps in the user sProps staking contract
            }
        }

        // Transfer any left Props back to the user
        if (unstakedAmount > 0) {
            propsToken.transfer(msg.sender, unstakedAmount);
        }
    }
}
