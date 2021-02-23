// SPDX-License-Identifier: MIT

pragma solidity 0.7.3;

interface IRPropsToken {
    function distributeRewards(
        address _sPropsAppStaking,
        uint256 _appRewardsPercentage,
        address _sPropsUserStaking,
        uint256 _userRewardsPercentage
    ) external;

    function withdrawRewards(
        address _propsAppStaking,
        uint256 _appRewardsAmount,
        address _propsUserStaking,
        uint256 _userRewardsAmount
    ) external;

    function swap(address account) external;
}
