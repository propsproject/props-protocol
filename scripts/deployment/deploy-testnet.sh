#!/usr/bin/bash

export TESTNET=1
export L1_NETWORK=goerli
export L2_NETWORK=mumbai

export ROOT_CHAIN_ID=5

# Update the root chain id in all contracts to allow for L1 signatures on L2
sed -i "s/ROOT_CHAIN_ID = 1/ROOT_CHAIN_ID = $ROOT_CHAIN_ID/g" $(find ./contracts -type f)

bash scripts/deployment/deploy.sh

# Get back to the previous state
sed -i "s/ROOT_CHAIN_ID = $ROOT_CHAIN_ID/ROOT_CHAIN_ID = 1/g" $(find ./contracts -type f)
