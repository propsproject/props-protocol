## `PropsProtocol`

The `PropsProtocol` contract is the single entry point for regular users to interact with the Props protocol. All protocol actions of regular users must go through the `PropsProtocol` contract which will, in turn, perform corresponding actions on other involved contracts that users should not (and cannot) directly interact with.

Moreover, the `PropsProtocol` contract is the owner and coordinator of most of the contracts involved in the Props protocol:

- it controls the rProps token contract, being responsible for initiating the rProps rewards distribution and withdrawal and for swapping rProps tokens for regular Props tokens
- it controls the sProps token contract, coordinating the minting and burning of sProps on each staking action
- it owns all staking contracts, being responsible for performing staking-related operations on all individual staking contracts and for making sure the staked amounts across all these staking contracts are always consistent

As mentioned above, the `PropsProtocol` contract handles minting and burning of sProps, the ERC20 governance token of the Props protocol. sProps tokens are in a 1:1 mapping with staked Props tokens (that is, for each staked Props token a corresponding sProps token will get minted, while for each withdrawn Props token a corresponding sProps token will get burned). sProps are not transferrable between users and they represent voting power in Props' governance process.

As an escape hatch for possible bugs, the `PropsProtocol` contract is pausable. Pausing it would simply forbid all user actions. The ability to pause and unpause the contract is given to a special address denoted as the Props guardian (however, the protocol controller is also able to pause the contract). Ideally, the Props guardian is a multi-sig of a few trusted addresses that, in case of bugs, can pause the contract until an upgrade that fixes the bug goes through the governance process.

### Architecture

##### Stake on behalf

Stake on behalf of a given account. The sender provides the funds and the apps to stake to together with the amount to stake to each app, but the stakes will get associated with the requested account.

```solidity
function stakeOnBehalf(
    address[] _apps,
    uint256[] _amounts,
    address _account
)
```

##### Stake

Adjust the stake amounts to the given apps. Positive stake amounts correspond to an increase in the amount staked to a particular app while negative amounts correspond to a decrease in the staked amount.

```solidity
function stake(address[] _apps, int256[] _amounts)
```

##### Stake as delegate

Delegated staking. Readjust existing stake on behalf of an account that explicitly delegated its staking rights. The delegatee cannot introduce new stake or remove existing stake on behalf of the delegator.

```solidity
function stakeAsDelegate(
    address[] _apps,
    int256[] _amounts,
    address _account
)
```

##### Stake rewards

Similar to regular stake, but the stake amounts are to be retrieved from the user's escrowed rewards instead of their wallet. User Props rewards are escrowed, meaning that once claimed they get locked for a known amount of time. However, these locked Props rewards can be separately staked in order to gain additional rewards.

```solidity
function stakeRewards(address[] _apps, int256[] _amounts)
```

##### Stake rewards as delegate

Delegated rewards staking. Readjust existing rewards stake on behalf of an account that explicitly delegated its staking rights. As opposed to `stakeAsDelegate`, the delegatee can introduce new stake from the delegator's rewards escrow but it cannot withdraw existing stake.

```solidity
function stakeRewardsAsDelegate(
    address[] _apps,
    int256[] _amounts,
    address _account
)
```

##### Claim AppPoints rewards

Allow users to claim their AppPoints rewards from any given app token. The claimed AppPoints tokens will get transferred from the AppPoints staking contract to the user's wallet.

```solidity
function claimAppPointsRewards(address _app)
```

##### Claim app Props rewards

Allow app owners to claim the Props rewards of their apps. The claimed Props rewards will get transferred from the app Props staking contract to the specified wallet address.

```solidity
function claimAppPropsRewards(address _app, address _wallet)
```

##### Claim app Props rewards and stake

Allow app owners to claim and directly stake the Props rewards of their apps. All claimed rewards will get staked to the current app.

```solidity
function claimAppPropsRewardsAndStake(address _app)
```

##### Claim user Props rewards

Allow users to claim their Props rewards. These Props rewards will get into the user's escrowed rewards pool. This action will also reset the cooldown period of the escrow.

```solidity
function claimUserPropsRewards()
```

##### Claim user Props rewards and stake

Allow users to claim their Props rewards and directly stake them to apps, without having the rewards escrow cooldown get reset. All claimed rewards will get staked to the given apps, according to the given percentages.

```solidity
function claimUserPropsRewardsAndStake(
    address[] _apps,
    uint256[] _percentages
)
```

##### Claim user Props rewards and stake as delegate

Claim and directly stake the Props rewards on behalf of a delegator account.

```solidity
function claimUserPropsRewardsAndStakeAsDelegate(
    address[] _apps,
    uint256[] _percentages,
    address _account
)
```

##### Unlock user Props rewards

Allow users to unlock their escrowed rewards, if the cooldown period passed. This action will transfer the Props rewards from the escrow to the user's wallet.

```solidity
function unlockUserPropsRewards()
```

##### Delegate

With delegation, accounts can outsource the following actions: adjust existing stake (without triggering any stake withdraws), stake rewards, claim and directly stake user Props rewards.

```solidity
function delegate(address _to)
```

##### Pause

Pause the contract.

```solidity
function pause()
```

##### Unpause

Unpause the contract.

```solidity
function unpause()
```

##### Update app whitelist

Update the set of whitelisted apps. Users can only stake to whitelisted apps. By default, any newly deployed app is blacklisted. Although staking to blacklisted apps is forbidden, withdrawing and claiming are still available.

```solidity
function updateAppWhitelist(address _app, bool _status)
```

##### Distribute Props rewards

Distribute the Props rewards to the app and user Props staking contracts. This will trigger the distribution method of the rProps token, which `PropsProtocol` owns.

```solidity
function distributePropsRewards(
    uint256 _amount,
    uint256 _appRewardsPercentage,
    uint256 _userRewardsPercentage
)
```

##### Withdraw Props rewards

Withdraw not yet distributed Props rewards from the app and user Props staking contracts. This action should only be performed in case of the protocol migrating to a new L2.

```solidity
function withdrawPropsRewards(uint256 _appRewardsAmount, uint256 _userRewardsAmount)
```
