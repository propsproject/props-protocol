## Deployment

Before triggering a deployment, make sure an `.env` file exists in the root directory of the project, containing the following:

```bash
INFURA_PROJECT_ID=

DEPLOYER_PRIVATE_KEY=
CONTROLLER_PRIVATE_KEY=
CONTROLLER_ADDRESS=
TREASURY_ADDRESS=
GUARDIAN_ADDRESS=

CONTROLLER_MULTISIG_L1=
CONTROLLER_MULTISIG_L2=
```

Make sure the deployer and controller accounts used during the deployment phase are properly funded (with both ETH and MATIC).

Deploying all contracts related to the Props protocol is as simple as running a simple script (`./scripts/deployment/deploy-mainnet.sh` or `./scripts/deployment/deploy-testnet.sh` depending on where you want to deploy). However, since the protocol mostly resides on L2, there are some additional steps required in order to integrate the Props token within the protocol and be able to move any Props from L1 to L2 where it can be used to interact with the protocol:

- request a token mapping from the Matic team (via https://mapper.matic.today/map) - their current interface only allows mapping tokens based on default predicates (`ERC20Predicate` in our case), however, we need the bridge to be able to mint Props tokens on demand (this allows the protocol to mint additional Props tokens on L2 and have the users be able to withdraw these L2-minted Props back to L1), so for this to happen we need to further request the Matic team to bridge the Props token based on their `MintableERC20Predicate`
- give the `MintableERC20PredicateProxy` contract (the contract address can be found at https://github.com/maticnetwork/static) minting permissions on the Props token so that it can mint additional Props token as needed

Once deployed, it is advisable to go through the post-deployment phase in order to increase the security of the protocol. The post-deployment scripts will transfer all administrative roles in the protocol from simple EOAs (the ones used during the deployment phase) to multi-sig wallets. Triggering the post-deployment scripts is similar to running the deployment scripts (either run `./scripts/post-deployment/post-deploy-mainnet.sh` or `./scripts/post-deployment/post-deploy-testnet.sh` depending on where you want to trigger the post-deployment scripts). The following changes will take place as part of the post-deployment phase:

- the control of `AppProxyFactoryL1` will be transferred to `CONTROLLER_MULTISIG_L1`
- the administration of `ProxyAdmin` on L1 will be transferred to `CONTROLLER_MULTISIG_L1`
- the ownership of `PropsTokenL2` will be transferred to `CONTROLLER_MULTISIG_L2`
- the control of `AppProxyFactoryL2` will be transferred to `CONTROLLER_MULTISIG_L2`
- the control of `PropsProtocol` will be transferred to `CONTROLLER_MULTISIG_L2`
- the administration of `ProxyAdmin` on L2 will be transferred to `CONTROLLER_MULTISIG_L2`

Additional notes:

- although we could have a single protocol controller multi-sig on L2 and have all actions relayed through the governance bridge (this would imply setting the L1 part of the governance bridge as the controller of all protocol contracts residing on L1), we decided that (for security and ease-of-use purposes) it's better to initially have different protocol controllers on the two layers
- the original Props token contract on L1 should go through the same steps of transferring any point of control to `CONTROLLER_MULTISIG_L1`
- since the Props treasury will be receiving AppPoints tokens on every mint, it is advisable to have `TREASURY_ADDRESS` setup as a 1-of-1 multi-sig controlled by the protocol controller (`CONTROLLER_MULTISIG_L1`)
