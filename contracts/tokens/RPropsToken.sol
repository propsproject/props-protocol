// SPDX-License-Identifier: MIT
pragma solidity >=0.6.0 <0.7.0;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/math/SafeMathUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";

import "../interfaces/IPropsToken.sol";
import "../interfaces/IRPropsToken.sol";
import "../interfaces/IStaking.sol";

/**
 * @title  RPropsToken
 * @author Props
 * @dev    The rProps token represents future Props rewards. Its role is to get
 *         distributed to the app and user Props staking contracts and have the
 *         rewards in those contracts be earned in rProps. The rProps token is
 *         then swappable for regular Props tokens.
 */
contract RPropsToken is Initializable, OwnableUpgradeable, ERC20Upgradeable, IRPropsToken {
    using SafeMathUpgradeable for uint256;

    address public propsToken;

    /**
     * @dev Initializer.
     * @param _owner The owner of the contract
     * @param _propsToken The address of the Props token contract
     */
    function initialize(address _owner, address _propsToken) public initializer {
        OwnableUpgradeable.__Ownable_init();
        ERC20Upgradeable.__ERC20_init("rProps", "rProps");

        if (_owner != msg.sender) {
            transferOwnership(_owner);
        }

        propsToken = _propsToken;
    }

    /**
     * @dev Distribute rProps rewards to the app and user Props staking contracts.
     *      This action mints the maximum possible amount of rProps and calls the
     *      rewards distribution action to the staking contracts.
     * @param _sPropsAppStaking The Props staking contract for apps
     * @param _appRewardsPercentage The percentage of minted rProps to get distributed to apps
     * @param _sPropsUserStaking The Props staking contract for users
     * @param _userRewardsPercentage The percentage of minted rProps to get distributed to users
     */
    function distributeRewards(
        address _sPropsAppStaking,
        uint256 _appRewardsPercentage,
        address _sPropsUserStaking,
        uint256 _userRewardsPercentage
    ) external override onlyOwner {
        // The percentages must add up to 100%
        require(_appRewardsPercentage.add(_userRewardsPercentage) == 1e6, "Bad input");

        // Mint all available rProps
        uint256 totalToMint =
            IPropsToken(propsToken).maxTotalSupply().sub(
                IERC20Upgradeable(propsToken).totalSupply()
            );

        if (totalToMint > 0) {
            // Distribute app rewards
            uint256 appRewards = totalToMint.mul(_appRewardsPercentage).div(1e6);
            _mint(_sPropsAppStaking, appRewards);
            IStaking(_sPropsAppStaking).notifyRewardAmount(balanceOf(_sPropsAppStaking));

            // Distribute user rewards
            uint256 userRewards = totalToMint.sub(appRewards);
            _mint(_sPropsUserStaking, userRewards);
            IStaking(_sPropsUserStaking).notifyRewardAmount(balanceOf(_sPropsUserStaking));
        }
    }

    /**
     * @dev Swap an account's rProps balance for regular Props.
     * @param account The swap recipient
     */
    function swap(address account) external override onlyOwner {
        uint256 amount = balanceOf(account);
        if (amount > 0) {
            // Burn the rProps
            _burn(account, amount);

            // Mint Props
            IPropsToken(propsToken).mint(account, amount);
        }
    }
}
