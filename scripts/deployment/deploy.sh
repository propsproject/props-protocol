#!/usr/bin/bash

# Generic deployment script
# Do not use directly (it depends on correctly configured environment variables)

set -e

COLOR='\033[0;33m'
CLEAR='\033[0m'

# Deploy L1 and L2 contracts
printf "${COLOR}Deploying L1 contracts on ${L1_NETWORK}...${CLEAR}\n"
DEPLOY=1 npx hardhat --network $L1_NETWORK run scripts/deployment/deploy-l1.ts
printf "${COLOR}Deploying L2 contracts on ${L2_NETWORK}...${CLEAR}\n"
DEPLOY=1 npx hardhat --network $L2_NETWORK run scripts/deployment/deploy-l2.ts

# Connect L1 - L2 bridges
printf "${COLOR}Connecting L1 contracts to L2...${CLEAR}\n"
CONNECT=1 npx hardhat --network $L1_NETWORK run scripts/deployment/deploy-l1.ts
printf "${COLOR}Connecting L2 contracts to L1...${CLEAR}\n"
CONNECT=1 npx hardhat --network $L2_NETWORK run scripts/deployment/deploy-l2.ts