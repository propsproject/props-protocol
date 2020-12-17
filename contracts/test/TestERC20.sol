// SPDX-License-Identifier: MIT
pragma solidity ^0.6.0;

import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";

contract TestERC20 is ERC20Upgradeable {
    constructor(
        string memory _name,
        string memory _symbol,
        uint256 _amount
    ) public {
        ERC20Upgradeable.__ERC20_init(_name, _symbol);

        _mint(msg.sender, _amount);
    }
}
