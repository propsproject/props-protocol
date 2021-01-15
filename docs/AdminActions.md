## Admin Actions

All administrative actions related to Props-owned contracts are to be executed by three designated addresses: the upgradeability admin, the PropsController owner and the Props guardian.

As the name suggests, the upgradeability admin is responsible and allowed to upgrade any upgradeable contracts in the Props protocol. More details on how the upgrades are done and how the upgradeability owner is able to transfer its role to other designated addresses can be found in OpenZeppelin's [docs](https://docs.openzeppelin.com/cli/2.8/contracts-architecture#upgrades).

The PropsController owner has the ability to perform certain restricted actions on the PropsController contract:

- set the sProps and rProps tokens contracts
- set the app and user sProps staking contracts
- set the rewards escrow cooldown period
- set the implementation contract for new app token contracts
- set the implementation contract for new app token staking contracts
- whitelist an app
- blacklist an app
- distribute the Props rewards to apps and users (this is a one-time action)

The Props guardian has the ability to pause/unpause the `PropsController` contract in case of bugs. More details can be found in the `PropsController` [docs](./PropsController.md).

Besides this, the designated owners of individual apps can perform certain administrative actions on the corresponding AppToken contracts. More details on this can be found in the `AppToken` [docs](./AppToken.md).
