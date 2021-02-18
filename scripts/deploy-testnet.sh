#!/usr/bin/bash

set -e

BLUE='\033[0;34m'
CLEAR='\033[0m'

# Deploy L1 and L2 contracts
printf "${BLUE}Deploying L1 contracts on Goerli...${CLEAR}\n"
L1_NETWORK=goerli L2_NETWORK=mumbai DEPLOY=1 npx hardhat --network goerli run scripts/deploy-l1.ts
printf "${BLUE}Deploying L2 contracts on Mumbai...${CLEAR}\n"
L1_NETWORK=goerli L2_NETWORK=mumbai DEPLOY=1 npx hardhat --network mumbai run scripts/deploy-l2.ts

# Connect any L1 - L2 bridges
printf "${BLUE}Connecting L1 contracts to L2...${CLEAR}\n"
L1_NETWORK=goerli L2_NETWORK=mumbai CONNECT=1 npx hardhat --network goerli run scripts/deploy-l1.ts
printf "${BLUE}Connecting L2 contracts to L1...${CLEAR}\n"
L1_NETWORK=goerli L2_NETWORK=mumbai CONNECT=1 npx hardhat --network mumbai run scripts/deploy-l2.ts

# Test the deployment
printf "${BLUE}Testing deployment...${CLEAR}\n"
L1_NETWORK=goerli L2_NETWORK=mumbai TEST=1 npx hardhat --network goerli run scripts/deploy-l1.ts
