## `AppProxyFactory`

The `AppProxyFactory` contract is responsible for deploying new apps to be integrated within the Props protocol. It comes in two variants, one for deploying new apps on layer 1 and another for deploying on layer 2. However, external actors can only interact with the layer 1 variant of the factory. An L1 app deployment will create a layer 1 AppPoints token but will also trigger an app deployment on layer 2 (via an L1 - L2 bridge).

## Architecture

##### Deploy app

Deploy a new app for integration withing the Props protocol. This action will deploy an AppPoints token on layer 1 and an AppPoints token together with a corresponding staking contract for the token on layer 2. The new app will also be automatically integrated within the Props protocol on layer 2.

```solidity
function deployApp(
    string _name,
    string _symbol,
    uint256 _amount,
    address _owner,
    uint256 _dailyRewardEmission
)
```
