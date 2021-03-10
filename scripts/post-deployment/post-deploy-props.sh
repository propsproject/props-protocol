#!/usr/bin/bash

# Generic post-deployment script for the Props token
# Do not use directly (it depends on correctly configured environment variables)

set -e

COLOR='\033[0;33m'
CLEAR='\033[0m'

# Run post-deployment actions on the Props token
printf "${COLOR}Running post-deployment actions for thenL1 Props token contract on ${L1_NETWORK}...${CLEAR}\n"
npx hardhat --network $L1_NETWORK run scripts/post-deployment/post-deploy-props-l1.ts
printf "${COLOR}Running post-deployment actions for the L2 Props token contract on ${L2_NETWORK}...${CLEAR}\n"
npx hardhat --network $L2_NETWORK run scripts/post-deployment/post-deploy-props-l2.ts
