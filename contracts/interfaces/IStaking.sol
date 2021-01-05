// SPDX-License-Identifier: MIT
pragma solidity ^0.6.0;

interface IStaking {
    function totalSupply() external view returns (uint256);

    function balanceOf(address _account) external view returns (uint256);

    function earned(address _account) external view returns (uint256);

    function stake(address _account, uint256 _amount) external;

    function withdraw(address _account, uint256 _amount) external;

    function claimReward(address _account) external;

    function notifyRewardAmount(uint256 _reward) external;
}
