#!/usr/bin/bash

export L1_NETWORK=goerli

export OWNER_PRIVATE_KEY=0x33d7ba7f33be8adb557dc29fcd5743d9042c6d43a97743b057b42bdfb95b9cab
export NAME=AnotherTest
export SYMBOL=ATEST
export AMOUNT=1000000000
export DAILY_REWARDS_EMISSION=0.25

DEPLOY_APP=1 npx hardhat --network $L1_NETWORK run scripts/setup/run-on-l1.ts