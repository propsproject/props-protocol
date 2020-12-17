// SPDX-License-Identifier: MIT
pragma solidity ^0.6.0;

interface IStaking {
    function lastTimeRewardApplicable() external view returns (uint256);

    function rewardPerToken() external view returns (uint256);

    function earned(address account) external view returns (uint256);

    function getRewardForDuration() external view returns (uint256);

    function totalSupply() external view returns (uint256);

    function balanceOf(address account) external view returns (uint256);

    function stake(address account, uint256 amount) external;

    function withdraw(address account, uint256 amount) external;

    function getReward(address account) external;

    function notifyRewardAmount(uint256 reward) external;
}
