## `AppTokenProxyFactory`

The `AppTokenProxyFactory` contract is responsible for deploying and keeping track of all deployed AppTokens (and their corresponding staking contracts). The main reason for having this functionality separate from the `PropsController` is contract size.

## Architecture

##### Deploy AppToken

Create and deploy a new AppToken together with its corresponding staking contract. The AppToken contract will be owned by the app's designated owner, while the staking contract will be owned by the `PropsController`. Optionally, it is possible to specify the percentage of the AppToken owner's minted tokens that should directly get distributed as rewards to the AppToken staking contract.

```solidity
function deployAppToken(
    string calldata _name,
    string calldata _symbol,
    uint256 _amount,
    address _owner,
    uint256 _dailyRewardEmission,
    uint256 _rewardsDistributedPercentage
) external returns (address)
```
