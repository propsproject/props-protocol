## Roles and permissions

In the Props protocol, several entities have special permissions on various aspects of the protocol. The following attempts to provide a description covering these special addresses and the impact they have over the protocol. Please note that the following only deals with roles and permissions that are to be held by external entities (and not by protocol contracts themselves - eg. `PropsProtocol` controlling `RPropsToken` and `SPropsToken`).

Besides the permissions described below, the upgradeability of the protocol contracts on each of the two layers is controlled by the `ProxyAdmin` admin account (a different `ProxyAdmin` contract will reside on L1 and L2).

One additional note is that, although it seems like a lot of entities have special roles and permissions on the protocol, most of these roles will be played out by the same entities (all protocol contracts residing on the same layer will be controller by a designated protocol controller address - specific details can be found in the [deployment docs](./Deployment.md)).

##### `AppProxyFactoryL1` controller

- transfer control
- change the logic contract for the L1 variant of AppPoints tokens
- change the L1 app deployment bridge contract

##### `AppProxyFactoryL2` controller

- transfer control
- change the logic contract for the L2 variant of AppPoints tokens
- change the logic contract for AppPoints staking
- change the L2 app deployment bridge contract

##### `PropsProtocol` controller

- transfer control/guardianship
- pause/unpause the protocol
- change the cooldown period for the escrowed Props rewards
- update the app whitelist
- distribute/withdraw rProps rewards
- change the daily rewards emission rate on the app/user Props staking contract

##### `PropsProtocol` guardian

- pause/unpause the protocol

##### `PropsTokenL2` owner

- add/remove minters

##### `AppPointsL1` owner

- mint AppPoints tokens
- change the inflation rate

##### `AppPointsL2` owner

- add/remove minter
- change app info
