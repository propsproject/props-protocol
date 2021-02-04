// SPDX-License-Identifier: MIT

pragma solidity 0.6.8;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";

import "./utils/MinimalProxyFactory.sol";

import "./interfaces/IAppPoints.sol";
import "./interfaces/IPropsProtocol.sol";
import "./interfaces/IStaking.sol";

contract AppProxyFactory is Initializable, MinimalProxyFactory {
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

    /**************************************
                     EVENTS
    ***************************************/

    event AppDeployed(
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
                  USER ACTIONS
    ****************************************/

    /**
     * @dev Deploy a new app.
     * @param _name The name of the app
     * @param _symbol The symbol of the app
     * @param _amount The initial amount of app points to be minted
     * @param _owner The owner of the app
     * @param _dailyRewardEmission The daily reward emission parameter for the app points staking contract
     * @param _rewardsDistributedPercentage Percentage of the initially minted app points to get distributed as rewards
     */
    function deployApp(
        string calldata _name,
        string calldata _symbol,
        uint256 _amount,
        address _owner,
        uint256 _dailyRewardEmission,
        uint256 _rewardsDistributedPercentage
    ) external {
        // Deploy the app points contract
        address appPointsProxy =
            deployMinimal(
                appPointsLogic,
                abi.encodeWithSignature(
                    "initialize(string,string,uint256,address,address,uint256)",
                    _name,
                    _symbol,
                    _amount,
                    _owner,
                    propsTreasury,
                    _rewardsDistributedPercentage
                )
            );

        // Deploy the corresponding staking contract for the app points
        address appPointsStakingProxy =
            deployMinimal(
                appPointsStakingLogic,
                abi.encodeWithSignature(
                    "initialize(address,address,address,address,uint256)",
                    propsProtocol,
                    // The app proxy factory contract is responsible for the initial rewards distribution
                    address(this),
                    appPointsProxy,
                    propsToken,
                    _dailyRewardEmission
                )
            );

        // Pause app points transfers
        IAppPoints(appPointsProxy).pause();

        // The following addresses are whitelisted for app points transfers:
        // - the app owner
        // - the PropsProtocol contract
        // - the app points staking contract
        // - the app proxy factory contract

        IAppPoints(appPointsProxy).whitelistAddress(_owner);
        IAppPoints(appPointsProxy).whitelistAddress(propsProtocol);
        IAppPoints(appPointsProxy).whitelistAddress(appPointsStakingProxy);
        IAppPoints(appPointsProxy).whitelistAddress(address(this));

        // Transfer ownership to the app owner
        OwnableUpgradeable(appPointsProxy).transferOwnership(_owner);

        // If requested, perform the initial app points rewards distribution
        uint256 rewards = IERC20Upgradeable(appPointsProxy).balanceOf(address(this));
        if (rewards > 0) {
            IERC20Upgradeable(appPointsProxy).transfer(appPointsStakingProxy, rewards);
            IStaking(appPointsStakingProxy).notifyRewardAmount(rewards);
        }

        // Assign rewards distribution to the app owner
        IStaking(appPointsStakingProxy).changeRewardsDistribution(_owner);

        IPropsProtocol(propsProtocol).saveApp(appPointsProxy, appPointsStakingProxy);

        emit AppDeployed(appPointsProxy, appPointsStakingProxy, _name, _symbol, _owner);
    }
}
