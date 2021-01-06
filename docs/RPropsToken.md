## `RPropsToken`

rProps tokens represent future Props rewards. They were introduced as a workaround to having to mint all remaining Props tokens in order to get them distributed to the app and user Props rewards pools. The initial total supply of rProps is equal to the total amount of Props yet to be minted (`maxTotalSupply - totalSupply`). When staking, apps and users earn their Props rewards in rProps, but when claimed, these rProps get burned and equivalent regular Props tokens will get minted to replace them.

The `RPropsToken` contract is owned by the `PropsController`. Moreover, the `RPropsToken` contract should have minting permissions on the Props token contract. Also, the `RPropsToken` contract should be the designated rewards distribution address in the staking contracts for earning apps and users Props rewards.

#### Architecture

##### Distribute rewards

Mint all available rProps tokens and distribute them to the staking contracts for earning apps and users Props rewards. The distribution will also trigger the start of the rewards period on those two staking contracts. The amount of rProps distributed to each rewards pool is determined by the given percentages.

```solidity
function distributeRewards(
    address _sPropsAppStaking,
    uint256 _appRewardsPercentage,
    address _sPropsUserStaking,
    uint256 _userRewardsPercentage
) external override onlyOwner
```

##### Swap

Convert an account's rProps tokens to regular Props tokens. The rProps will get burned, while a corresponding Props amount will get minted.

```solidity
function swap(address account) external override onlyOwner
```
