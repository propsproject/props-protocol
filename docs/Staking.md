## `Staking`

The `Staking` contract powers all staking operations in the Props protocol. Staking allows users to earn rewards by locking their tokens. In the Props protocol, rewards are distributed in a perpetual fashion, closely following a diminishing returns curve (that is, the closest we get to the end of the rewards distribution period, the fewest are the rewards).

Staking is the core functionality of the Props protocol. Anyone can stake their Props tokens to the existing apps. By staking, users earn two types of rewards:

- AppToken rewards: for staking their Props to a particular app, users earn rewards in that app's associated token
- Props rewards: for staking their Props to a particular app, users earn rewards in Props

Moreover, apps also earn rewards in Props, their stakes being the total amount of tokens staked by users to that particular app.

In total, there are three types of staking rewards:

- users earn AppToken rewards by staking Props
- users earn Props rewards by staking sProps
- apps earn Props rewards by staking sProps

All staking contracts are exclusively owned by the `PropsController`. Staking-related operations (stake, withdraw, claim) are to be done through the `PropsController` which will proxy the calls to the individual staking contracts.
