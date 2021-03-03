## `RPropsToken`

rProps tokens represent future Props rewards. They were introduced as a workaround to having to mint Props tokens (and thus increasing the total supply) in order to get them distributed to the app and user Props rewards pools. When staking, apps and users earn their Props rewards in rProps, but when claimed, these rProps get burned and an equivalent amount of regular Props tokens will get minted to replace them.

The following setup is required:

- the `RPropsToken` controller must be the `PropsProtocol` contract
- the `RPropsToken` contract must have minting permissions on the `PropsTokenL2` contract
- the `RPropsToken` contract must be the designated rewards distribution address in the app and user Props staking contracts

Since the controller of `RPropsToken` must be the `PropsProtocol` contract, any calls to it (eg. `distributeRewards`, `withdrawRewards`, `swap`) must be initiated by `PropsProtocol`.

## Architecture

##### Distribute rewards

Mint the given amount of rProps tokens and distribute them to the staking contracts for earning apps and users Props rewards. The distribution will also trigger the start of the rewards distribution period on those two staking contracts. The amount of rProps distributed to each rewards pool is determined by the given percentages.

```solidity
function distributeRewards(
    uint256 _amount,
    uint256 _appRewardsPercentage,
    uint256 _userRewardsPercentage
)
```

##### Withdraw rewards

Withdraw and burn the given amounts of rProps tokens from the app and user Props staking contracts. This action should only happen in case of migrating the protocol to a new L2. In such a scenario, the amount of rProps withdrawn and burned via this action will get re-distributed as rewards on the new L2 the protocol is migrating to. The caller of this function must ensure that the given amounts represent valid rProps amounts that were not yet earned by any staker.

```solidity
function withdrawRewards(
    uint256 _appRewardsAmount,
    uint256 _userRewardsAmount
)
```

##### Change daily app reward emission

Change the daily reward emission rate on the app Props staking contract.

```solidity
function changeDailyAppRewardEmission(uint256 _appDailyRewardEmission)
```

##### Change daily user reward emission

Change the daily reward emission rate on the user Props staking contract.

```solidity
function changeDailyUserRewardEmission(uint256 _userDailyRewardEmission)
```

##### Swap

Convert an account's rProps tokens to regular Props tokens. The rProps will get burned, while a corresponding Props amount will get minted.

```solidity
function swap(address _account)
```
