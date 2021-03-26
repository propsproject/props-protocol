#!/usr/bin/bash

export L2_NETWORK=mumbai

export CONTROLLER_PRIVATE_KEY=
export APP=

WHITELIST_APP=1 npx hardhat --network $L2_NETWORK run scripts/setup/run-on-l2.ts