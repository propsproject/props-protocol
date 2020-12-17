// SPDX-License-Identifier: MIT
pragma solidity ^0.6.0;

import "@openzeppelin/contracts-upgradeable/proxy/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "../temp-oz-contracts-for-proxy/upgradeability/ProxyFactory.sol";

import "./StakingManager.sol";

contract AppTokenManager is Initializable, ProxyFactory, StakingManager {
    address public appTokenImplementationContract;
    address public appTokenStakingImplementationContract;

    address[] public appTokens;

    event AppTokenDeployed(
        address indexed appTokenAddress,
        address indexed appTokenStakingAddress,
        string name,
        uint256 amount
    );

    function initialize(
        address _propsToken,
        address _appTokenImplementationContract,
        address _appTokenStakingImplementationContract
    ) public initializer {
        StakingManager.__StakingManager_init(_propsToken);

        appTokenImplementationContract = _appTokenImplementationContract;
        appTokenStakingImplementationContract = _appTokenStakingImplementationContract;
    }

    function deployAppToken(
        string memory _name,
        string memory _symbol,
        uint256 _amount,
        address _owner,
        address _propsTreasury,
        uint256 _dailyRewardsEmission
    ) public returns (address) {
        bytes memory appTokenPayload =
            abi.encodeWithSignature(
                "initialize(string,string,uint256,address,address)",
                _name,
                _symbol,
                _amount,
                _owner,
                _propsTreasury
            );
        address appTokenProxy = deployMinimal(appTokenImplementationContract, appTokenPayload);

        bytes memory appTokenStakingPayload =
            abi.encodeWithSignature(
                "initialize(address,address,address,uint256)",
                _owner,
                appTokenProxy,
                propsToken,
                _dailyRewardsEmission
            );
        address appTokenStakingProxy =
            deployMinimal(appTokenStakingImplementationContract, appTokenStakingPayload);

        appTokens.push(appTokenProxy);
        appTokenToStaking[appTokenProxy] = appTokenStakingProxy;

        emit AppTokenDeployed(appTokenProxy, appTokenStakingProxy, _name, _amount);

        return appTokenProxy;
    }
}
