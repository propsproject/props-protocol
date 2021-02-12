## Props Protocol

The Props protocol comprises of a suite of upgradeable smart contracts. More details can be found in the corresponding documentation files of individual contracts:

- [`AppPoints`](./docs/AppPoints.md)
- [`AppProxyFactory`](./docs/AppProxyFactory.md)
- [`PropsProtocol`](./docs/PropsProtocol.md)
- [`RPropsToken`](./docs/RPropsToken.md)
- [`Staking`](./docs/Staking.md)

The following also provide a detailed overview of certain aspects of the Props protocol:

- [Admin Actions](./docs/AdminActions.md)

### Layer 2 Scaling

In order to improve user experience and avoid the high gas fees on Ethereum, the Props protocol resides on a layer 2 solution, anchored on main Ethereum chain. Initially, this will be [Polygon](https://polygon.technology/), but the protocol is designed in such a way so as to allow the migration to any Ethereum-rooted layer 2 solution.

### Deployment

When deploying, make sure you have an `.env` file in the root of the project containing the following:

```bash
INFURA_PROJECT_ID=
MNEMONIC=
```

The addresses used for deployment are generated from the above mnemonic, so make sure you have enough ETH/MATIC in order to cover the deployment and setup gas fees.

Since the protocol is laid out across L1 and L2, separate deployment scripts are needed for each layer. `./scripts/deploy-testnet.sh` abstractizes this and can be used to deploy and connect everything in one go.
