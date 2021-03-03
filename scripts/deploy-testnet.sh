#!/usr/bin/bash

export TESTNET=1
export L1_NETWORK=goerli
export L2_NETWORK=mumbai

export ROOT_CHAIN_ID=5
export PROPS_REWARDS_AMOUNT=100000000

# Update the root chain id in all contracts to allow for L1 signatures on L2
sed -i "s/ROOT_CHAIN_ID = [[:digit:]]\+/ROOT_CHAIN_ID = $ROOT_CHAIN_ID/g" $(find ./contracts -type f)

bash scripts/deploy.sh

# Get back to the previous state
sed -i "s/ROOT_CHAIN_ID = $ROOT_CHAIN_ID\+/ROOT_CHAIN_ID = 1/g" $(find ./contracts -type f)
