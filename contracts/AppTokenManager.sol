// SPDX-License-Identifier: MIT
pragma solidity ^0.6.0;

import "./AppToken.sol";
import "../temp-oz-contracts-for-proxy/upgradeability/ProxyFactory.sol";

contract AppTokenManager is ProxyFactory {
    // EVENTS

    event AppTokenCreated(address indexed tokenAddress, string name, uint256 amount);

    // STORAGE

    address public implementationContract;
    address[] public appTokens;

    constructor(address _implementationContract) public {
        implementationContract = _implementationContract;
    }

    function createAppToken(
        string memory _name,
        string memory _symbol,
        uint256 _amount,
        address _owner,
        address _propsOwner
    ) public returns (address) {
        bytes memory payload =
            abi.encodeWithSignature(
                "initialize(string,string,uint256,address,address)",
                _name,
                _symbol,
                _amount,
                _owner,
                _propsOwner
            );
        address proxy = deployMinimal(implementationContract, payload);
        emit AppTokenCreated(proxy, _name, _amount);

        appTokens.push(proxy);
        return proxy;
    }
}
