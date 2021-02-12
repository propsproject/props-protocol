// SPDX-License-Identifier: MIT

pragma solidity 0.7.3;

import "../../fx-portal/contracts/tunnel/FxBaseRootTunnel.sol";
import "../interfaces/IAppProxyFactoryBridged.sol";

contract AppProxyFactoryBridgeL1 is FxBaseRootTunnel, IAppProxyFactoryBridged {
    address public appProxyFactory;

    constructor(
        address _checkpointManager,
        address _fxRoot,
        address _appProxyFactory
    ) FxBaseRootTunnel(_checkpointManager, _fxRoot) {
        appProxyFactory = _appProxyFactory;
    }

    function deployApp(
        address _l1AppPoints,
        string calldata _name,
        string calldata _symbol,
        address _owner,
        uint256 _dailyRewardEmission
    ) external override {
        require(msg.sender == appProxyFactory, "Unauthorized");
        _sendMessageToChild(abi.encode(_l1AppPoints, _name, _symbol, _owner, _dailyRewardEmission));
    }

    function _processMessageFromChild(bytes memory) internal pure override {}
}
