// SPDX-License-Identifier: MIT
pragma solidity ^0.6.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface ILockableERC20 is IERC20 {
    function totalBalanceOf(address account) external view returns (uint256);

    function transferWithLock(address dst, uint256 amount) external returns (bool);

    function unlock(address account, uint256[] calldata lockTimesToUnlock) external;
}
