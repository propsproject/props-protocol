## Props Protocol

The Props protocol comprises of a suite of upgradeable smart contracts. More details can be found in the corresponding documentation files of individual contracts:

- [`AppToken`](./docs/AppToken.md)
- [`PropsController`](./docs/PropsController.md)
- [`RPropsToken`](./docs/RPropsToken.md)
- [`Staking`](./docs/Staking.md)

The following also provide a detailed overview of certain aspects of the Props protocol:

- [Admin Actions](./docs/AdminActions.md)

##### Optimism integration

Issues:

- OpenZeppelin's upgrades plugin doesn't seem to work with Optimism (see [here](https://forum.openzeppelin.com/t/openzeppelin-upgrades-support-for-optimism/5511))
- the `PropsController` contract is not properly transpiled to OVM and fails the contract code safety check when deploying to OVM (see [here](https://discord.com/channels/667044843901681675/676980316518481930/803589109569421332) and [here](https://discord.com/channels/667044843901681675/676980316518481930/803721739950751744))
