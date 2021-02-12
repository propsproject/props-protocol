// SPDX-License-Identifier: MIT

pragma solidity 0.7.3;

import "@openzeppelin/contracts-upgradeable/math/SafeMathUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";

import "../../fx-portal/contracts/tunnel/FxBaseRootTunnel.sol";

import "../interfaces/IPropsToken.sol";

contract PropsTokenBridgeL1 is FxBaseRootTunnel {
    using SafeMathUpgradeable for uint256;

    address public propsToken;

    constructor(
        address _checkpointManager,
        address _fxRoot,
        address _propsToken
    ) FxBaseRootTunnel(_checkpointManager, _fxRoot) {
        propsToken = _propsToken;
    }

    function deposit(address _account, uint256 _amount) public {
        IERC20Upgradeable(propsToken).transferFrom(msg.sender, address(this), _amount);
        _sendMessageToChild(abi.encode(_account, _amount));
    }

    function _processMessageFromChild(bytes memory _data) internal override {
        (address account, uint256 amount) = abi.decode(_data, (address, uint256));

        uint256 lockedBalance = IERC20Upgradeable(propsToken).balanceOf(address(this));
        if (lockedBalance < amount) {
            IPropsToken(propsToken).mint(address(this), amount.sub(lockedBalance));
        }

        IERC20Upgradeable(propsToken).transfer(account, amount);
    }
}
