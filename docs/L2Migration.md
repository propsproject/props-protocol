## L2 migration

The Props protocol is designed in such a way so that a possible migration to a new L2 is possible. In such a case, users would have to migrate their stakes to the new L2. However, before that is possible, several steps have to be taken on the protocol side:

- all protocol contracts have to be deployed on the new L2 (and properly configured)
- rProps (Props) rewards that were not yet distributed to users are to be withdrawn from the staking contracts and burned
- apps have to re-deploy to the new L2
- apps have to withdraw any not yet distributed AppPoints tokens rewards from their staking contracts and move them to the new L2

The amount of rProps that was withdrawn and burned on the old L2 will get re-distributed on the new L2. There is no way to enforce this on-chain but in case these amounts don't match or anything else looks misconfigured in the new setup users should simply refuse to use the new instance of the protocol.

If a migration is intended while the protocol is governance-owned, additional steps have to be taken.
// TODO: Address migrating while governance is active
