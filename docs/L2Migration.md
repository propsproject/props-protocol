## L2 migration

The Props protocol is designed in such a way so that a possible migration to a new L2 is possible. In such a case, users would have to migrate their stakes to the new L2. However, before that is possible, the following actions must be considered on the protocol side:

- all protocol contracts have to be deployed on the new L2 (and properly configured)
- rProps (Props) rewards that were not yet distributed to users are to be withdrawn from the app and user Props staking contracts and burned
- apps have to re-deploy to the new L2
- apps have to withdraw any not yet distributed AppPoints tokens rewards from their staking contracts and move them to the new L2

The amount of rProps that was withdrawn and burned on the old L2 will get re-distributed on the new L2. There is no way to enforce this on-chain but in case these amounts don't match or anything else looks misconfigured in the new setup users should simply refuse to use the new instance of the protocol.

Re-deployment of all the apps from the old L2 to the new L2 should be done directly on the new L2 instance (no need to have this action available on L1 and then relayed to the new L2 instance since the AppPoints contracts already exist on L1 from the initial app deployment on the old L2). However, we need an approval mechanism to only allow previously existing apps to re-deploy and ensure that only addresses that can prove ownership of apps on the old L2 can re-deploy.

If the migration happens while the Props protocol is not governance-owned, the above actions can be taken directly through the controller addresses. However, if the protocol is governance-owned (or partially governance-owned) at the time of the migration, the above actions must be included in a governance proposal. Additionally, since a migration requires users to move their stake and stake represents the sProps governance token of the Props protocol, governance actions should get paused during the migration. This is to ensure no malicious proposals can get through due to the low supply of sProps. Also, for the same reason, the governance on the new L2 should get paused for a predefined amount of time to allow users to move their stake (and associated sProps) to the new protocol instance.
