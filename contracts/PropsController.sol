// SPDX-License-Identifier: MIT
pragma solidity ^0.6.0;

import "@openzeppelin/contracts-upgradeable/proxy/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";

import "../temp-oz-contracts-for-proxy/upgradeability/ProxyFactory.sol";

import "./staking/StakingManager.sol";

/**
 * @dev The PropsController is the single entry point for participating
 *   in the Props protocol. It is responsible for deploying new app tokens
 *   and associated app token staking contracts and, by inheriting from the
 *   StakingManager, it also acts as a proxy for all staking-related operations.
 */
contract PropsController is Initializable, ProxyFactory, StakingManager {
    /// @dev The Props protocol treasury address
    address public propsTreasury;

    /// @dev Logic contract for app token contract proxies
    address public appTokenImplementationContract;
    /// @dev Logic contract for app token staking contract proxies
    address public appTokenStakingImplementationContract;

    /// @dev List of all deployed app tokens
    address[] public appTokens;

    event AppTokenDeployed(
        address indexed appTokenAddress,
        address indexed appTokenStakingAddress,
        string name,
        uint256 amount
    );

    /**
     * @param _propsTreasury The Props protocol treasury that a percentage of all minted app tokens will go to
     * @param _propsToken The Props token contract
     * @param _rPropsToken The rProps token contract
     * @param _sPropsAppStaking The sProps token contract used for app staking
     * @param _sPropsUserStaking The sProps token contract used for user staking
     * @param _appTokenImplementationContract The logic contract for app token contract proxies
     * @param _appTokenStakingImplementationContract The logic contract for app token staking contract proxies
     */
    function initialize(
        address _propsTreasury,
        address _propsToken,
        address _rPropsToken,
        address _sPropsAppStaking,
        address _sPropsUserStaking,
        address _appTokenImplementationContract,
        address _appTokenStakingImplementationContract
    ) public initializer {
        StakingManager.__StakingManager_init(
            _propsToken,
            _rPropsToken,
            _sPropsAppStaking,
            _sPropsUserStaking
        );

        propsTreasury = _propsTreasury;
        appTokenImplementationContract = _appTokenImplementationContract;
        appTokenStakingImplementationContract = _appTokenStakingImplementationContract;
    }

    /**
     * @dev Deploy a new app token
     * @param _name The name of the app token
     * @param _symbol The symbol of the app token
     * @param _amount The initial amount of app tokens to be minted
     * @param _owner The owner of the app token
     * @param _dailyRewardsEmission The daily rewards emission parameter for the app token's staking contract
     */
    function deployAppToken(
        string calldata _name,
        string calldata _symbol,
        uint256 _amount,
        address _owner,
        // TODO Ask if we really need this or just pass a hardcoded value
        uint256 _dailyRewardsEmission
    ) external returns (address) {
        // Deploy the app token contract
        bytes memory appTokenPayload =
            abi.encodeWithSignature(
                "initialize(string,string,uint256,address,address)",
                _name,
                _symbol,
                _amount,
                _owner,
                propsTreasury
            );
        address appTokenProxy = deployMinimal(appTokenImplementationContract, appTokenPayload);

        // Deploy the corresponding staking contract for the app token
        bytes memory appTokenStakingPayload =
            abi.encodeWithSignature(
                "initialize(address,address,address,address,uint256)",
                address(this),
                _owner,
                appTokenProxy,
                propsToken,
                _dailyRewardsEmission
            );
        address appTokenStakingProxy =
            deployMinimal(appTokenStakingImplementationContract, appTokenStakingPayload);

        // Save the address of the app token contract
        appTokens.push(appTokenProxy);
        // Associate the app token's staking contract with the app token
        super.saveAppToken(appTokenProxy, appTokenStakingProxy);

        emit AppTokenDeployed(appTokenProxy, appTokenStakingProxy, _name, _amount);
        return appTokenProxy;
    }
}
