// SPDX-License-Identifier: MIT
pragma solidity ^0.6.0;

import "@openzeppelin/contracts-upgradeable/math/SafeMathUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/math/SignedSafeMathUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";

import "./AppTokenStaking.sol";
import "./SProps.sol";

abstract contract StakingManager is Initializable, SProps {
    using SafeMathUpgradeable for uint256;

    IERC20Upgradeable public propsToken;

    mapping(address => address) public appTokenToStaking;
    mapping(address => mapping(address => uint256)) public userStakes;
    mapping(address => uint256) public appStakes;

    function __StakingManager_init(address _propsToken) public initializer {
        SProps.__SProps_init();

        propsToken = IERC20Upgradeable(_propsToken);
    }

    function stakeOnBehalf(
        address[] calldata _appTokens,
        uint256[] calldata _amounts,
        address _account
    ) external {
        for (uint256 i = 0; i < _appTokens.length; i++) {
            require(appTokenToStaking[_appTokens[i]] != address(0), "Invalid app token");

            AppTokenStaking appTokenStaking = AppTokenStaking(appTokenToStaking[_appTokens[i]]);

            userStakes[msg.sender][_appTokens[i]] = userStakes[msg.sender][_appTokens[i]].add(
                _amounts[i]
            );
            appStakes[_appTokens[i]] = appStakes[_appTokens[i]].add(_amounts[i]);

            propsToken.transferFrom(msg.sender, address(this), _amounts[i]);
            super.mint(_account, _amounts[i]);

            propsToken.approve(address(appTokenStaking), _amounts[i]);
            appTokenStaking.stake(_account, _amounts[i]);

            // TODO Also stake user sProps and app sProps
        }
    }

    function adjustStakes(address[] calldata _appTokens, int256[] calldata _amounts) external {
        require(_appTokens.length == _amounts.length, "Arity mismatch");

        uint256 unstakedAmount = 0;
        for (uint256 i = 0; i < _appTokens.length; i++) {
            require(appTokenToStaking[_appTokens[i]] != address(0), "Invalid app token");

            AppTokenStaking appTokenStaking = AppTokenStaking(appTokenToStaking[_appTokens[i]]);
            if (_amounts[i] < 0) {
                uint256 amountToUnstake = uint256(SignedSafeMathUpgradeable.mul(_amounts[i], -1));

                appTokenStaking.withdraw(msg.sender, amountToUnstake);
                userStakes[msg.sender][_appTokens[i]] = userStakes[msg.sender][_appTokens[i]].sub(
                    amountToUnstake
                );
                appStakes[_appTokens[i]] = appStakes[_appTokens[i]].sub(amountToUnstake);

                // TODO Unstake app sProps

                unstakedAmount = unstakedAmount.add(amountToUnstake);
            }
        }

        for (uint256 i = 0; i < _appTokens.length; i++) {
            AppTokenStaking appTokenStaking = AppTokenStaking(appTokenToStaking[_appTokens[i]]);
            if (_amounts[i] > 0) {
                uint256 amountToStake = uint256(_amounts[i]);

                userStakes[msg.sender][_appTokens[i]] = userStakes[msg.sender][_appTokens[i]].add(
                    amountToStake
                );
                appStakes[_appTokens[i]] = appStakes[_appTokens[i]].add(amountToStake);

                if (unstakedAmount >= amountToStake) {
                    unstakedAmount = unstakedAmount.sub(amountToStake);
                } else {
                    propsToken.transferFrom(
                        msg.sender,
                        address(this),
                        amountToStake.sub(unstakedAmount)
                    );
                    super.mint(msg.sender, amountToStake.sub(unstakedAmount));

                    // TODO Stake user sProps

                    unstakedAmount = 0;
                }

                propsToken.approve(address(appTokenStaking), amountToStake);
                appTokenStaking.stake(msg.sender, amountToStake);

                // TODO Stake app sProps
            }
        }

        if (unstakedAmount > 0) {
            // TODO: unstake user sProps
            propsToken.transfer(msg.sender, unstakedAmount);
            super.burn(msg.sender, unstakedAmount);
        }
    }
}
