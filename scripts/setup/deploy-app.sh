#!/usr/bin/bash

export L1_NETWORK=goerli

export OWNER_PRIVATE_KEY=
export NAME=
export SYMBOL=
export AMOUNT=
export DAILY_REWARDS_EMISSION=

DEPLOY_APP=1 npx hardhat --network $L1_NETWORK run scripts/setup/run-on-l1.ts