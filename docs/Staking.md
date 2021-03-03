## `Staking`

The `Staking` contract powers all staking operations in the Props protocol. Staking allows users to earn rewards by locking their tokens. In the Props protocol, rewards are distributed in a perpetual fashion, closely following a diminishing returns curve (that is, the closest we get to the end of the rewards distribution period, the fewest the rewards).

Staking is the core functionality of the Props protocol. Anyone can stake their Props tokens to the existing apps. By staking, users earn two types of rewards:

- AppPoints rewards: for staking their Props to a particular app, users earn rewards in that app's associated token
- Props rewards: for staking their Props to a particular app, users earn rewards in Props

Moreover, apps also earn rewards in Props, based on the total amount of tokens staked by users to that particular app.

In total, there are three types of staking rewards:

- users earn AppPoints rewards by staking Props (staking is done explicitly)
- users earn Props rewards by staking sProps (staking is done implicitly)
- apps earn Props rewards by staking sProps (staking is done implicitly)

All staking contracts are exclusively owned by the `PropsProtocol`. Staking-related operations (stake, withdraw, claim) are to be done through the `PropsProtocol` contract which will proxy the calls to the individual staking contracts.

One feature of the Props protocol is staking delegation. Users are able to delegate their staking rights to a trusted account who can then readjust stakes to apps on behalf of the delegator. One caveat is that delegated staking can only be used to readjust existing stake but not to introduce new stake or withdraw existing stake. Delegated staking works on both regular staking and rewards staking. Moreover, delegators are also able to claim and directly stake their delegator's earned Props rewards.

One caveat with regard to staking is that the staking rewards are withdrawable (that is, the `rewardsDistribution` address - the account responsible for distributing the staking rewards - has the right to withdraw any of the reward tokens that were not yet earned by any user). This design choice was made so that the protocol is not permanently tied to a particular L2 solution but can easily migrate as needed (on a potential migration to another L2, the token rewards that were not yet earned by any user can simply be withdrawn and ported over to the new L2 - rProps rewards are a special case since they only reside on L2 and cannot be ported, but check out [L2Migration](./L2Migration.md) for more details on handling rProps).
