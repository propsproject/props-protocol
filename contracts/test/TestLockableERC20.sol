// SPDX-License-Identifier: MIT
pragma solidity ^0.6.0;

import "../LockableERC20.sol";

contract TestLockableERC20 is LockableERC20 {
    constructor(
        string memory name,
        string memory symbol,
        uint256 amount
    ) public LockableERC20(name, symbol) {
        _mint(msg.sender, amount);
    }
}
