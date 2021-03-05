#!/usr/bin/bash

# Generic post-deployment script
# Do not use directly (it depends on correctly configured environment variables)

set -e

COLOR='\033[0;33m'
CLEAR='\033[0m'

# Run post-deployment actions
printf "${COLOR}Running post-deployment actions for L1 contracts on ${L1_NETWORK}...${CLEAR}\n"
npx hardhat --network $L1_NETWORK run scripts/post-deployment/post-deploy-l1.ts
printf "${COLOR}Running post-deployment actions for L2 contracts on ${L2_NETWORK}...${CLEAR}\n"
npx hardhat --network $L2_NETWORK run scripts/post-deployment/post-deploy-l2.ts
