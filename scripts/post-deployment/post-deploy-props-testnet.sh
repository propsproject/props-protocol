#!/usr/bin/bash

export L1_NETWORK=goerli
export L2_NETWORK=mumbai

export PROPS_TOKEN_L1_ADDRESS=
export PROPS_TOKEN_L1_PROXY_ADMIN_ADDRESS=
export PROTOCOL_L1_PROXY_ADMIN_ADDRESS=

bash scripts/post-deployment/post-deploy-props.sh
