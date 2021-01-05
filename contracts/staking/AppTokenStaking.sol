// SPDX-License-Identifier: MIT
pragma solidity ^0.6.0;

import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";

import "./BaseStaking.sol";

/**
 * @title  AppTokenStaking
 * @author Props
 * @notice Reward stakers of Props with AppToken rewards, on a pro-rata basis.
 * @dev    It overrides the default behavior of `BaseStaking`, so that the Props
 *         tokens get transferred to/from this contract when staking/withdrawing.
 */
contract AppTokenStaking is BaseStaking {
    /**
     * @dev Initializer.
     * @param _owner The owner of the contract
     * @param _rewardsDistribution The designated rewards distribution address
     * @param _appToken The app token rewards are denominated in
     * @param _propsToken The Props token address
     * @param _dailyRewardEmission The percentage of the remaining rewards pool to get distributed each day
     */
    function initialize(
        address _owner,
        address _rewardsDistribution,
        address _appToken,
        address _propsToken,
        uint256 _dailyRewardEmission
    ) public initializer {
        BaseStaking.__BaseStaking_init(
            _owner,
            _rewardsDistribution,
            _appToken,
            _propsToken,
            _dailyRewardEmission
        );
    }

    /// @dev On staking, transfer the staked Props tokens from the owner to this staking contract.
    function _stakeCallback(uint256 _amount) internal override {
        IERC20Upgradeable(stakingToken).safeTransferFrom(owner(), address(this), _amount);
    }

    /// @dev On withdrawing, transfer the withdrawn Props tokens from the staking contract back to the owner.
    function _withdrawCallback(uint256 _amount) internal override {
        IERC20Upgradeable(stakingToken).safeTransfer(owner(), _amount);
    }
}
