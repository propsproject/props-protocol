// SPDX-License-Identifier: MIT
pragma solidity >=0.6.0 <0.7.0;

import "@openzeppelin/contracts-upgradeable/proxy/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";

contract TestERC20 is Initializable, ERC20Upgradeable {
    function initialize(
        string memory _name,
        string memory _symbol,
        uint256 _amount
    ) public initializer {
        ERC20Upgradeable.__ERC20_init(_name, _symbol);

        _mint(msg.sender, _amount);
    }
}
