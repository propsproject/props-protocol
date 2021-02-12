// SPDX-License-Identifier: MIT

pragma solidity 0.7.3;

interface IRPropsToken {
    function distributeRewards(
        address _sPropsAppStaking,
        uint256 _appRewardsPercentage,
        address _sPropsUserStaking,
        uint256 _userRewardsPercentage
    ) external;

    function swap(address account) external;
}
