#!/usr/bin/bash

export L2_NETWORK=mumbai

export OWNER_PRIVATE_KEY=
export AMOUNT=50000000

# YouNow
export APP_POINTS=0x1335f881a68ecea9a81fc3d256a49300a9ea53b0
export APP_POINTS_STAKING=0xaa150f5c68665be65ffca5a5a5511102c437ebb0

# # Listia
# export APP_POINTS=0x82a8e61217186e86998cbe36d0a4b770d8d0889d
# export APP_POINTS_STAKING=0xb2f2913e72abb834433d6678fb048f19c90b9500

# # Camfrog
# export APP_POINTS=0x497540be7d6a3d0c7543e6f174348463af9746b3
# export APP_POINTS_STAKING=0xe9c226e2a4be21e7a5dc2c7dfeb7f1f4b05e7548

# # Paltalk
# export APP_POINTS=0x6e386d827719adec100052449ee628f177c4b337
# export APP_POINTS_STAKING=0x06c2b4d466ef06f560df5581a669892686c0c627

# # Tegger
# export APP_POINTS=0xb88a075608430cd33eda5dda6b477508a386a611
# export APP_POINTS_STAKING=0x8b003fd34060bd81dd86aae1273eed52600b7860

MINT_ON_L2=1 npx hardhat --network $L2_NETWORK run scripts/setup/run-on-l2.ts
# DISTRIBUTE=1 npx hardhat --network $L2_NETWORK run scripts/setup/run-on-l2.ts