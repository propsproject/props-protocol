// SPDX-License-Identifier: MIT

pragma solidity 0.7.3;

import "@openzeppelin/contracts-upgradeable/math/SafeMathUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";

import "../../staking/IStaking.sol";
import "./IPropsTokenL2.sol";
import "./IRPropsToken.sol";

/**
 * @title  RPropsToken
 * @author Props
 * @dev    The rProps token represents future Props rewards. Its role is to get
 *         distributed to the app and user Props staking contracts and have the
 *         rewards in those contracts be earned in rProps. The rProps token is
 *         then swappable for regular Props tokens. This acts as a workaround
 *         for having to mint Props tokens before actual distribution to users.
 */
contract RPropsToken is Initializable, ERC20Upgradeable, IRPropsToken {
    using SafeMathUpgradeable for uint256;

    /**************************************
                     FIELDS
    ***************************************/

    // The rProps token controller
    address public controller;

    // Props protocol related tokens
    address public propsToken;

    // Keeps track of whether the rProps have been distributed as rewards
    bool public distributed;

    // The amount of rProps to mint and distribute as rewards
    uint256 public amountToDistribute;

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
     * @param _amount The amount of rProps to mint and distribute as rewards
     * @param _controller The rProps token controller
     * @param _propsToken The address of the Props token contract
     */
    function initialize(
        uint256 _amount,
        address _controller,
        address _propsToken
    ) public initializer {
        ERC20Upgradeable.__ERC20_init("rProps", "RPROPS");

        amountToDistribute = _amount;
        controller = _controller;
        propsToken = _propsToken;
    }

    /***************************************
                CONTROLLER ACTIONS
    ****************************************/

    /**
     * @dev Distribute rProps rewards to the app and user Props staking contracts.
     *      This action mints the initially set amount of rProps and calls the
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
        // This is a one-time only action
        require(!distributed, "Rewards already distributed");
        distributed = true;

        // The percentages must add up to 100%
        require(_appRewardsPercentage.add(_userRewardsPercentage) == 1e6, "Invalid percentages");

        // Distribute app rProps rewards
        uint256 appRewards = amountToDistribute.mul(_appRewardsPercentage).div(1e6);
        _mint(_propsAppStaking, appRewards);
        IStaking(_propsAppStaking).notifyRewardAmount(balanceOf(_propsAppStaking));

        // Distribute user rProps rewards
        uint256 userRewards = amountToDistribute.sub(appRewards);
        _mint(_propsUserStaking, userRewards);
        IStaking(_propsUserStaking).notifyRewardAmount(balanceOf(_propsUserStaking));
    }

    /**
     * @dev Withdraw rProps rewards from the app and user Props staking contracts.
     * @param _propsAppStaking The app Props staking contract
     * @param _appRewardsAmount The amount of rProps to get withdrawn from the app Props staking contract
     * @param _propsUserStaking The user Props staking contract
     * @param _userRewardsAmount The amount of rProps to get withdrawn from the user Props staking contract
     */
    function withdrawRewards(
        address _propsAppStaking,
        uint256 _appRewardsAmount,
        address _propsUserStaking,
        uint256 _userRewardsAmount
    ) external override only(controller) {
        // Withdraw and burn app rProps rewards
        IStaking(_propsAppStaking).withdrawReward(_appRewardsAmount);
        _burn(address(this), _appRewardsAmount);

        // Withdraw user rProps rewards
        IStaking(_propsUserStaking).withdrawReward(_userRewardsAmount);
        _burn(address(this), _userRewardsAmount);
    }

    /**
     * @dev Swap an account's rProps balance for regular Props.
     * @param _account The swap recipient
     */
    function swap(address _account) external override only(controller) {
        uint256 amount = balanceOf(_account);
        if (amount > 0) {
            // Burn rProps
            _burn(_account, amount);

            // Mint Props
            IPropsTokenL2(propsToken).mint(_account, amount);
        }
    }
}
