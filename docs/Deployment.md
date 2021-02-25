## Deployment

Deploying all contracts related to the Props protocol is as simple as running a simple script (`./scripts/deploy-mainnet.sh` or `./scripts/deploy-testnet.sh` depending on where you want to deploy). However, since the protocol mostly resides on L2, there are some additional steps required in order to integrate the Props token within the protocol and be able to move any Props from L1 to L2 where it can be used to interact with the protocol:

- request a token mapping from the Matic team (via [https://mapper.matic.today/map]) - their current interface only allows one to map tokens based on default predicates (`ERC20Predicate` in our case), however, we need the bridge to be able to mint Props tokens on demand (this allows the protocol to mint additional Props tokens on L2 and have the users be able to withdraw these L2-minted Props back to L1), so for this to happen we need to further request the Matic team to bridge the Props token based on their `MintableERC20Predicate`
- give the `MintableERC20PredicateProxy` contract (the contract address can be found at [https://github.com/maticnetwork/static]) minting permissions so that it can mint additional Props token as needed

One configurable option when deploying is the amount of Props (rProps) that is to get distributed as rewards on the L2 where the protocol will reside. This option is configurable via the `PROPS_REWARDS_AMOUNT` environment variable which can be tweaked as needed directly in the deployment scripts.

TODO: Decide on whether we allow multiple Props rewards distribution rounds.
