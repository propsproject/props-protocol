#!/usr/bin/bash

set -e

# Deploy L1 and L2 contracts
L1_NETWORK=goerli L2_NETWORK=mumbai DEPLOY=1 npx hardhat --network goerli run scripts/deploy-l1.ts
L1_NETWORK=goerli L2_NETWORK=mumbai DEPLOY=1 npx hardhat --network mumbai run scripts/deploy-l2.ts

# Connect any L1 - L2 bridges
L1_NETWORK=goerli L2_NETWORK=mumbai CONNECT=1 npx hardhat --network goerli run scripts/deploy-l1.ts
L1_NETWORK=goerli L2_NETWORK=mumbai CONNECT=1 npx hardhat --network mumbai run scripts/deploy-l2.ts

# Test the deployment
L1_NETWORK=goerli L2_NETWORK=mumbai TEST=1 npx hardhat --network goerli run scripts/deploy-l1.ts
