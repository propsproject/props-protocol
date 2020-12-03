import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { BigNumber } from "ethers";
import { ethers } from "hardhat";

import { AppToken } from "../typechain/AppToken";
import { AppTokenManager } from "../typechain/AppTokenManager";
import { StakingRewards } from "../typechain/StakingRewards";
import { TestErc20 } from "../typechain/TestErc20";
import { createAppToken, deployContract } from "./utils";

chai.use(solidity);
const { expect } = chai;

const REWARDS_TOKEN_NAME = "App Token";
const REWARDS_TOKEN_SYMBOL = "APPTKN";
const REWARDS_TOKEN_AMOUNT = BigNumber.from(1e10);

const STAKING_TOKEN_NAME = "Props Token";
const STAKING_TOKEN_SYMBOL = "PROPS";
const STAKING_TOKEN_AMOUNT = BigNumber.from(1e10);

// Corresponds to 0.0003658
const STAKING_REWARDS_DAILY_EMISSION = BigNumber.from(3658).mul(1e11);

describe("StakingRewards", () => {
  let appTokenManager: AppTokenManager;

  let rewardsToken: AppToken;
  let stakingToken: TestErc20;
  let stakingRewards: StakingRewards;
  let signers: SignerWithAddress[];

  beforeEach(async () => {
    signers = await ethers.getSigners();

    const appTokenLogic: AppToken = await deployContract("AppToken", signers[0]);
    appTokenManager = await deployContract("AppTokenManager", signers[0], appTokenLogic.address);

    rewardsToken = await createAppToken(
      appTokenManager,
      REWARDS_TOKEN_NAME,
      REWARDS_TOKEN_SYMBOL,
      REWARDS_TOKEN_AMOUNT,
      signers[0].address,
      signers[1].address
    ) as AppToken;

    stakingToken = await deployContract(
      "TestERC20",
      signers[0],
      STAKING_TOKEN_NAME,
      STAKING_TOKEN_SYMBOL,
      STAKING_TOKEN_AMOUNT
    );
    stakingRewards = await deployContract(
      "StakingRewards",
      signers[0],
      signers[0].address,
      rewardsToken.address,
      stakingToken.address,
      STAKING_REWARDS_DAILY_EMISSION
    );
  });
});
