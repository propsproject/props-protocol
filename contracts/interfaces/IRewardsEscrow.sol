// SPDX-License-Identifier: MIT
pragma solidity ^0.6.0;

interface IRewardsEscrow {
    function lockedBalanceOf(address account) external view returns (uint256);

    function lock(address account, uint256 amount) external returns (bool);

    function unlock(address account, uint256[] calldata blocksToUnlock) external;
}
