// SPDX-License-Identifier: MIT

pragma solidity 0.7.3;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";

import "./utils/MinimalProxyFactory.sol";

import "./interfaces/IAppPoints.sol";
import "./interfaces/IPropsProtocol.sol";
import "./interfaces/IStaking.sol";

/**
 * @title  AppProxyFactoryL2
 * @author Props
 * @dev    The L2 factory responsible for deploying new apps. An L2 app
 *         deployment can only be triggered via the L2 bridge, as a result
 *         of a corresponding L1 deployment.
 */
contract AppProxyFactoryL2 is Initializable, MinimalProxyFactory {
    /**************************************
                     FIELDS
    ***************************************/

    // The app proxy factory controller
    address public controller;

    // The PropsProtocol contract
    address public propsProtocol;

    // The Props protocol treasury address
    address public propsTreasury;

    // Props protocol related tokens
    address public propsToken;

    // Logic contract for app points contract proxies
    address public appPointsLogic;
    // Logic contract for app points staking contract proxies
    address public appPointsStakingLogic;

    // The bridge contract used to relay app deployments from L1
    address public appProxyFactoryBridge;

    /**************************************
                     EVENTS
    ***************************************/

    event AppDeployed(
        address indexed l1AppPoints,
        address indexed appPoints,
        address indexed appPointsStaking,
        string name,
        string symbol,
        address owner
    );

    /**************************************
                    MODIFIERS
    ***************************************/

    modifier only(address _account) {
        require(msg.sender == _account, "Unauthorized");
        _;
    }

    /***************************************
                   INITIALIZER
    ****************************************/

    /**
     * @dev Initializer.
     * @param _controller The app proxy factory controller
     * @param _propsProtocol The PropsProtocol contract
     * @param _propsTreasury The Props protocol treasury that a percentage of all minted app points will go to
     * @param _propsToken The Props token contract
     * @param _appPointsLogic The logic contract for app points contract proxies
     * @param _appPointsStakingLogic The logic contract for app points staking contract proxies
     */
    function initialize(
        address _controller,
        address _propsProtocol,
        address _propsTreasury,
        address _propsToken,
        address _appPointsLogic,
        address _appPointsStakingLogic
    ) public initializer {
        controller = _controller;
        propsProtocol = _propsProtocol;
        propsTreasury = _propsTreasury;
        propsToken = _propsToken;
        appPointsLogic = _appPointsLogic;
        appPointsStakingLogic = _appPointsStakingLogic;
    }

    /***************************************
                CONTROLLER ACTIONS
    ****************************************/

    /**
     * @dev Set the app proxy factory bridge contract.
     * @param _appProxyFactoryBridge The address of the L2 bridge contract.
     */
    function setAppProxyFactoryBridge(address _appProxyFactoryBridge) external only(controller) {
        require(appProxyFactoryBridge == address(0), "Already set");
        appProxyFactoryBridge = _appProxyFactoryBridge;
    }

    /**
     * @dev Change the logic contract for app points contract proxies.
     * @param _appPointsLogic The address of the new logic contract
     */
    function changeAppPointsLogic(address _appPointsLogic) external only(controller) {
        appPointsLogic = _appPointsLogic;
    }

    /**
     * @dev Change the logic contract for app points staking contract proxies.
     * @param _appPointsStakingLogic The address of the new logic contract
     */
    function changeAppPointsStakingLogic(address _appPointsStakingLogic) external only(controller) {
        appPointsStakingLogic = _appPointsStakingLogic;
    }

    /***************************************
                 BRIDGE ACTIONS
    ****************************************/

    /**
     * @dev Deploy a new app.
     * @param _l1AppPoints The address of the corresponding L1 AppPoints token contract
     * @param _name The name of the app
     * @param _symbol The symbol of the app
     * @param _owner The owner of the app
     * @param _dailyRewardEmission The daily reward emission parameter for the app points staking contract
     */
    function deployApp(
        address _l1AppPoints,
        string calldata _name,
        string calldata _symbol,
        address _owner,
        uint256 _dailyRewardEmission
    ) external only(appProxyFactoryBridge) {
        // Deploy the app points contract
        address appPointsProxy =
            deployMinimal(
                appPointsLogic,
                abi.encodeWithSignature(
                    "initialize(string,string,address)",
                    _name,
                    _symbol,
                    // TODO: Replace with the bridge address
                    _owner
                )
            );

        // Deploy the corresponding staking contract for the app points
        address appPointsStakingProxy =
            deployMinimal(
                appPointsStakingLogic,
                abi.encodeWithSignature(
                    "initialize(address,address,address,uint256)",
                    propsProtocol,
                    _owner,
                    appPointsProxy,
                    _dailyRewardEmission
                )
            );

        // Pause app points transfers
        IAppPoints(appPointsProxy).pause();

        // The following addresses are whitelisted for app points transfers:
        // - the app owner
        // - the PropsProtocol contract
        // - the app points staking contract

        IAppPoints(appPointsProxy).whitelistForTransfers(_owner);
        IAppPoints(appPointsProxy).whitelistForTransfers(propsProtocol);
        IAppPoints(appPointsProxy).whitelistForTransfers(appPointsStakingProxy);

        // Transfer ownership to the app owner
        OwnableUpgradeable(appPointsProxy).transferOwnership(_owner);

        IPropsProtocol(propsProtocol).saveApp(appPointsProxy, appPointsStakingProxy);

        emit AppDeployed(
            _l1AppPoints,
            appPointsProxy,
            appPointsStakingProxy,
            _name,
            _symbol,
            _owner
        );
    }
}
