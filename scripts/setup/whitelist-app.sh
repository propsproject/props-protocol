#!/usr/bin/bash

export L2_NETWORK=mumbai

export CONTROLLER_PRIVATE_KEY=
export APP=0x164082301e4a782d7d35200cc211c6750b68ee62

WHITELIST_APP=1 npx hardhat --network $L2_NETWORK run scripts/setup/run-on-l2.ts