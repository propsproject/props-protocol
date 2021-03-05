## `PropsToken`

The Props protocol is fully powered by the Props token, which is used by users to stake to their favourite apps. However, originally, the Props token resides on L1 and has no L2 counterpart. So, for users to be able to use their L1 Props in the Props protocol that resides on L2, we need a way to bridge the Props token back and forth between the two layers.

Due to the way the protocol works, new Props tokens will get minted on L2 (because of users earning and claiming rProps rewards), tokens that are not backed by any L1 Props tokens residing in the L1 bridge contract. So, in order to allow users to withdraw these L2-minted Props tokens to L1, we need a custom bridge that can mint L1 Props tokens on demand if a user tries to withdraw tokens that were not deposited in the L1 bridge contract.

Moreover, the control of the Props token needs to be passed to the Props protocol controller (same goes with the proxy administration role - it needs to be passed to the `ProxyAdmin` contract in charge of the L1 protocol contracts).

The configuration required to allow for this setup is described in [Deployment](./Deployment.md).
