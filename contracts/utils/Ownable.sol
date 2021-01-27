// SPDX-License-Identifier: MIT

pragma solidity >=0.6.0 <0.7.0;

import "@openzeppelin/contracts-upgradeable/proxy/Initializable.sol";

import "../interfaces/IOwnable.sol";

abstract contract Ownable is Initializable, IOwnable {
    address private _owner;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    /**
     * @dev Initializer.
     */
    // solhint-disable-next-line func-name-mixedcase
    function __Ownable_init() internal initializer {
        _owner = msg.sender;
        emit OwnershipTransferred(address(0), msg.sender);
    }

    /**
     * @dev Returns the address of the current owner.
     */
    function owner() public view override returns (address) {
        return _owner;
    }

    /**
     * @dev Transfers ownership of the contract to a new account (`newOwner`).
     */
    function transferOwnership(address newOwner) public override {
        require(msg.sender == _owner);
        require(newOwner != address(0));

        _owner = newOwner;
        emit OwnershipTransferred(_owner, newOwner);
    }
}
