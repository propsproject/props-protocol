// SPDX-License-Identifier: MIT

pragma solidity 0.7.3;

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
 *         then swappable for regular Props tokens. This acts as a workaround
 *         for having to mint all left Props tokens beforehand.
 */
// TODO: Have different L1 and L2 token versions
contract RPropsToken is Initializable, ERC20Upgradeable, IRPropsToken {
    using SafeMathUpgradeable for uint256;

    /**************************************
                     FIELDS
    ***************************************/

    // The rProps token controller
    address public controller;

    // Props protocol related tokens
    address public propsToken;

    /**************************************
                    MODIFIERS
    ***************************************/

    modifier only(address _account) {
        require(msg.sender == _account, "Unauthorized");
        _;
    }

    /***************************************
                   INITIALIZER
    ****************************************/

    /**
     * @dev Initializer.
     * @param _controller The rProps token controller
     * @param _propsToken The address of the Props token contract
     */
    function initialize(address _controller, address _propsToken) public initializer {
        ERC20Upgradeable.__ERC20_init("rProps", "RPROPS");

        controller = _controller;
        propsToken = _propsToken;
    }

    /***************************************
                CONTROLLER ACTIONS
    ****************************************/

    /**
     * @dev Distribute rProps rewards to the app and user Props staking contracts.
     *      This action mints the maximum possible amount of rProps and calls the
     *      rewards distribution action on the staking contracts.
     * @param _propsAppStaking The app Props staking contract
     * @param _appRewardsPercentage The percentage of minted rProps to get distributed to apps
     * @param _propsUserStaking The user Props staking contract
     * @param _userRewardsPercentage The percentage of minted rProps to get distributed to users
     */
    function distributeRewards(
        address _propsAppStaking,
        uint256 _appRewardsPercentage,
        address _propsUserStaking,
        uint256 _userRewardsPercentage
    ) external override only(controller) {
        // The percentages must add up to 100%
        require(_appRewardsPercentage.add(_userRewardsPercentage) == 1e6, "Invalid percentages");

        // Mint all available rProps
        uint256 totalToMint =
            IPropsToken(propsToken).maxTotalSupply().sub(
                IERC20Upgradeable(propsToken).totalSupply()
            );

        require(totalToMint > 0, "No rewards left for distribution");

        // Distribute app rProps rewards
        uint256 appRewards = totalToMint.mul(_appRewardsPercentage).div(1e6);
        _mint(_propsAppStaking, appRewards);
        IStaking(_propsAppStaking).notifyRewardAmount(balanceOf(_propsAppStaking));

        // Distribute user rProps rewards
        uint256 userRewards = totalToMint.sub(appRewards);
        _mint(_propsUserStaking, userRewards);
        IStaking(_propsUserStaking).notifyRewardAmount(balanceOf(_propsUserStaking));
    }

    /**
     * @dev Swap an account's rProps balance for regular Props.
     * @param _account The swap recipient
     */
    function swap(address _account) external override only(controller) {
        uint256 amount = balanceOf(_account);
        if (amount > 0) {
            // Burn the rProps
            _burn(_account, amount);

            // Mint Props
            IPropsToken(propsToken).mint(_account, amount);
        }
    }
}
