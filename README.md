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

Since the protocol is laid out across L1 and L2, separate deployment scripts are needed for each layer. `./scripts/deploy-testnet.sh` abstractizes this and can be used to deploy and connect everything in one go. Running the script will generate two files in the root of the project - `goerli.json` and `mumbai.json` - containing the addresses of every Props protocol contract on the corresponding network.
For triggering a fresh deployment, delete these files and re-run the deployment script.

### Testing

The testnet deployment script from above deploys a test app for allowing to easily check that everything works fine. For checking that an L1 app deployment triggered a corresponding L2 app deployment, simply check the logs section of the L2 `AppProxyFactory` contract on Polygon's testnet explorer (give the bridging some time to propagate - ~10 minutes) - it should contain a log entry that corresponds to the `AppDeployed` event.

### Bridge

For seamless L1 - L2 communication between Ethereum and Polygon, we are using the [`fx-portal`](https://github.com/jdkanani/fx-portal) mapping-less bridge. The flow for connecting and using the bridge can be found by looking through the code of the L1 and L2 deployment scripts (`./scripts/deploy-l1.ts` and `./scripts/deploy-l2.ts`).
