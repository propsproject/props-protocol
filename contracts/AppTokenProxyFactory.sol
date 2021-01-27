// SPDX-License-Identifier: MIT
pragma solidity >=0.6.0 <0.7.0;

import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/Initializable.sol";

import "./interfaces/IAppToken.sol";
import "./interfaces/IPropsController.sol";
import "./interfaces/IStaking.sol";
import "./MinimalProxyFactory.sol";

contract AppTokenProxyFactory is Initializable, OwnableUpgradeable, MinimalProxyFactory {
    // The PropsController contract
    address public propsController;

    // The Props protocol treasury address
    address public propsTreasury;

    address public propsToken;

    // Logic contract for app token contract proxies
    address public appTokenLogic;
    // Logic contract for app token staking contract proxies
    address public appTokenStakingLogic;

    event AppTokenDeployed(
        address indexed appToken,
        address indexed appTokenStaking,
        string name,
        string symbol,
        address owner
    );

    /**
     * @dev Initializer.
     * @param _owner The owner of the contract
     * @param _propsController The PropsController contract
     * @param _propsTreasury The Props protocol treasury that a percentage of all minted app tokens will go to
     * @param _propsToken The Props token contract
     * @param _appTokenLogic The logic contract for app token contract proxies
     * @param _appTokenStakingLogic The logic contract for app token staking contract proxies
     */
    function initialize(
        address _owner,
        address _propsController,
        address _propsTreasury,
        address _propsToken,
        address _appTokenLogic,
        address _appTokenStakingLogic
    ) public initializer {
        OwnableUpgradeable.__Ownable_init();

        if (_owner != msg.sender) {
            transferOwnership(_owner);
        }

        propsController = _propsController;

        propsTreasury = _propsTreasury;

        propsToken = _propsToken;

        appTokenLogic = _appTokenLogic;
        appTokenStakingLogic = _appTokenStakingLogic;
    }

    /**
     * @dev Deploy a new app token.
     * @param _name The name of the app token
     * @param _symbol The symbol of the app token
     * @param _amount The initial amount of app tokens to be minted
     * @param _owner The owner of the app token
     * @param _dailyRewardEmission The daily reward emission parameter for the app token's staking contract
     * @param _rewardsDistributedPercentage Percentage of the initially minted app tokens to get distributed as rewards
     */
    function deployAppToken(
        string calldata _name,
        string calldata _symbol,
        uint256 _amount,
        address _owner,
        uint256 _dailyRewardEmission,
        uint256 _rewardsDistributedPercentage
    ) external {
        // In order to reduce gas costs, the minimal proxy pattern is used when creating new app tokens

        // Deploy the app token contract
        address appTokenProxy =
            deployMinimal(
                appTokenLogic,
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

        // Deploy the corresponding staking contract for the app token
        address appTokenStakingProxy =
            deployMinimal(
                appTokenStakingLogic,
                abi.encodeWithSignature(
                    "initialize(address,address,address,address,uint256)",
                    propsController,
                    // We are responsible for the initial rewards distribution
                    address(this),
                    appTokenProxy,
                    propsToken,
                    _dailyRewardEmission
                )
            );

        // Pause app token transfers
        IAppToken(appTokenProxy).pause();

        // Whitelist the app token owner
        IAppToken(appTokenProxy).whitelistAddress(_owner);
        // Whitelist the PropsController contract
        IAppToken(appTokenProxy).whitelistAddress(propsController);
        // Whitelist the app token staking contract
        IAppToken(appTokenProxy).whitelistAddress(appTokenStakingProxy);
        // Whitelist the AppTokenFactory contract
        IAppToken(appTokenProxy).whitelistAddress(address(this));

        // Transfer ownership to the app token owner
        OwnableUpgradeable(appTokenProxy).transferOwnership(_owner);

        // If requested, distribute the app token rewards
        uint256 rewards = IERC20Upgradeable(appTokenProxy).balanceOf(address(this));
        if (rewards > 0) {
            IERC20Upgradeable(appTokenProxy).transfer(appTokenStakingProxy, rewards);
            IStaking(appTokenStakingProxy).notifyRewardAmount(rewards);
        }

        // Assign rewards distribution to the app token owner
        IStaking(appTokenStakingProxy).setRewardsDistribution(_owner);

        IPropsController(propsController).saveAppToken(appTokenProxy, appTokenStakingProxy);

        emit AppTokenDeployed(appTokenProxy, appTokenStakingProxy, _name, _symbol, _owner);
    }

    /**
     * @dev Set the logic contract for app token contract proxies.
     * @param _appTokenLogic The address of the new logic contract
     */
    function setAppTokenLogic(address _appTokenLogic) external onlyOwner {
        appTokenLogic = _appTokenLogic;
    }

    /**
     * @dev Set the logic contract for app token staking contract proxies.
     * @param _appTokenStakingLogic The address of the new logic contract
     */
    function setAppTokenStakingLogic(address _appTokenStakingLogic) external onlyOwner {
        appTokenStakingLogic = _appTokenStakingLogic;
    }
}
