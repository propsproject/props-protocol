// SPDX-License-Identifier: MIT
pragma solidity ^0.6.0;

import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";

import "./BaseStaking.sol";

/**
 * @title  SPropsStaking
 * @author Props
 * @notice Reward stakers of sProps with rProps rewards, on a pro-rata basis.
 */
contract SPropsStaking is BaseStaking {
    /**
     * @dev Initializer.
     * @param _owner The owner of the contract
     * @param _rewardsDistribution The designated rewards distribution address
     * @param _rPropsToken The rProps token address
     * @param _sPropsToken The sProps token address
     * @param _dailyRewardEmission The percentage of the remaining rewards pool to get distributed each day
     */
    function initialize(
        address _owner,
        address _rewardsDistribution,
        address _rPropsToken,
        address _sPropsToken,
        uint256 _dailyRewardEmission
    ) public initializer {
        BaseStaking.__BaseStaking_init(
            _owner,
            _rewardsDistribution,
            _rPropsToken,
            _sPropsToken,
            _dailyRewardEmission
        );
    }
}
