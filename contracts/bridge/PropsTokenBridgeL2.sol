// SPDX-License-Identifier: MIT

pragma solidity 0.7.3;

import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";

import "../../fx-portal/contracts/tunnel/FxBaseChildTunnel.sol";

import "../interfaces/IPropsToken.sol";

contract PropsTokenBridgeL2 is FxBaseChildTunnel {
    address public propsToken;

    constructor(address _fxChild, address _propsToken) FxBaseChildTunnel(_fxChild) {
        propsToken = _propsToken;
    }

    function deposit(address _account, uint256 _amount) public {
        IPropsToken(propsToken).burn(msg.sender, _amount);
        _sendMessageToRoot(abi.encode(_account, _amount));
    }

    function _processMessageFromRoot(
        uint256,
        address _sender,
        bytes memory _data
    ) internal override validateSender(_sender) {
        (address account, uint256 amount) = abi.decode(_data, (address, uint256));
        IPropsToken(propsToken).mint(account, amount);
    }
}
