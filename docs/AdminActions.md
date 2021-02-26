## Admin actions

In the Props protocol, several entities have special permissions on various aspects of the protocol. The following attempts to provide a description covering most of these special addresses and the impact they have over the protocol. Please note that the role of some of these special addresses will be played by protocol contracts (eg. `PropsProtocol` controls `RPropsToken` and `SPropsToken`).

Besides the permissions described below, the Props protocol deployer is granted permissions to upgrade any upgradeable contracts in the Props protocol. More details on how the upgrades are done and how the upgradeability owner is able to transfer its role to other designated addresses can be found at OpenZeppelin's [docs](https://docs.openzeppelin.com/cli/2.8/contracts-architecture#upgrades).

##### `AppProxyFactoryL1` controller

- change the logic contract for the L1 variant of AppPoints tokens
- change the L1 app deployment bridge contract

##### `AppProxyFactoryL2` controller

- change the logic contract for the L2 variant of AppPoints tokens
- change the logic contract for AppPoints staking
- change the L2 app deployment bridge contract

##### `PropsProtocol` controller

- whitelist apps
- blacklist apps
- change the cooldown period for the escrowed Props rewards
- trigger the rProps rewards distribution
- withdraw rProps rewards

##### `PropsProtocol` guardian

- pause the protocol
- unpause the protocol

##### `SPropsToken` controller (reserved for `PropsProtocol`)

- mint sProps tokens
- burn sProps tokens

##### `RPropsToken` controller (reserved for `PropsProtocol`)

- distribute rProps rewards
- withdraw rProps rewards
- swap rProps for regular Props

##### `PropsTokenL2` owner

- add new minter
- remove existing minter

##### `PropsTokenL2` minters (reserved for bridges)

- mint L2 Props tokens
- burn L2 Props tokens

##### `AppPoints` owner

- add new minter on L2
- remove existing minter on L2
- change app info on L2
- mint L1 AppPoints tokens
- change the inflation rate on L1

##### `AppPoints` minters (reserved for bridges)

- mint L2 AppPoints tokens
- burn L2 AppPoints tokens
