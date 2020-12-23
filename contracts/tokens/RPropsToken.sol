// SPDX-License-Identifier: MIT
pragma solidity ^0.6.0;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/math/SafeMathUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";

import "../interfaces/IPropsToken.sol";
import "../interfaces/IRPropsToken.sol";
import "../interfaces/IStaking.sol";

contract RPropsToken is Initializable, OwnableUpgradeable, ERC20Upgradeable, IRPropsToken {
    using SafeMathUpgradeable for uint256;

    address public propsToken;

    function initialize(
        address _propsToken,
        address _sPropsAppStaking,
        uint256 _appRewardsPercentage,
        address _sPropsUserStaking,
        uint256 _userRewardsPercentage
    ) public initializer {
        require(
            _appRewardsPercentage.add(_userRewardsPercentage) == 1e6,
            "Invalid rewards distribution"
        );

        OwnableUpgradeable.__Ownable_init();
        ERC20Upgradeable.__ERC20_init("rProps", "rProps");

        propsToken = _propsToken;

        // Mint all needed rProps
        uint256 totalToMint =
            IPropsToken(propsToken).maxTotalSupply().sub(
                IERC20Upgradeable(propsToken).totalSupply()
            );

        // Distribute app rewards
        uint256 appRewards = totalToMint.mul(_appRewardsPercentage).div(1e6);
        _mint(_sPropsAppStaking, appRewards);
        IStaking(_sPropsAppStaking).notifyRewardAmount(balanceOf(_sPropsAppStaking));

        // Distribute user rewards
        uint256 userRewards = totalToMint.sub(appRewards);
        _mint(_sPropsUserStaking, userRewards);
        IStaking(_sPropsUserStaking).notifyRewardAmount(balanceOf(_sPropsUserStaking));
    }

    /**
     * @dev Swap an account's rProps balance to Props
     * @param account The swap recipient
     */
    function swap(address account) external override onlyOwner {
        uint256 amount = super.balanceOf(account);
        if (amount > 0) {
            // Burn the rProps
            _burn(account, amount);

            // Mint Props
            IPropsToken(propsToken).mint(account, amount);
        }
    }
}
