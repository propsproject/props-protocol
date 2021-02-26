## Bridging

Although mostly residing on L2 in order to avoid high gas fees and have a better UX, the Props protocol has some parts that live on L1. Consequently, there needs to be a way to bridge over any relevant actions/state between L1 and L2. For this, we make use of Matic's PoS bridge which allows for any state transfer back-and-forth between the two communicating layers.

##### Bridging Props

Bridging Props tokens from L1 to L2 and back is to be done via Matic's default token bridge. More details can be found at [`PropsToken`](./PropsToken.md).

##### Bridging app deployments

In the Props protocol, app deployments can only be triggered on L1. An app deployment on L1 will create an AppPoints token for the app (that lives on L1) but will, in turn, trigger a corresponding app deployment on L2 via a custom bridge. More details can be found at [`AppProxyFactory`](./AppProxyFactory.md).

##### Bridging governance actions

Props governance fully resides on L2. This implies that in order for the governance to be able to take actions affecting L1 state (eg. state related to the Props token), there needs to be a way to bridge them from L2 to L1. This is to be done over a custom bridge. More details can be found at [Governance](./Governance.md).
