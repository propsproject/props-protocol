import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { BigNumber } from "ethers";
import { ethers } from "hardhat";

import { AppToken } from "../typechain/AppToken";
import { AppTokenManager } from "../typechain/AppTokenManager";
import { StakingRewards } from "../typechain/StakingRewards";
import { TestErc20 } from "../typechain/TestErc20";
import { createAppToken, daysToTimestamp, deployContract, mineBlock } from "./utils";

chai.use(solidity);
const { expect } = chai;

const REWARDS_TOKEN_NAME = "App Token";
const REWARDS_TOKEN_SYMBOL = "APPTKN";
const REWARDS_TOKEN_AMOUNT = BigNumber.from(10).pow(18).mul(1000);

const STAKING_TOKEN_NAME = "Props Token";
const STAKING_TOKEN_SYMBOL = "PROPS";
const STAKING_TOKEN_AMOUNT = BigNumber.from(10).pow(18).mul(1000);

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

  it("distributing new rewards correctly sets different parameters", async () => {
    const reward = BigNumber.from(10).pow(18).mul(100);
    await rewardsToken.connect(signers[0]).transfer(stakingRewards.address, reward);
    await stakingRewards.connect(signers[0]).notifyRewardAmount(reward);

    // The rewards duration is set correctly
    const rewardsDuration = await stakingRewards.rewardsDuration();
    expect(rewardsDuration).to.eq(
      BigNumber.from(10).pow(18).div(STAKING_REWARDS_DAILY_EMISSION).mul(24).mul(3600)
    );

    // The reward rate is set correctly
    const rewardRate = await stakingRewards.rewardRate();
    expect(rewardRate).to.eq(reward.div(rewardsDuration));

    // The finish time is set correctly
    expect(await stakingRewards.periodFinish()).to.eq(
      BigNumber.from(await stakingRewards.lastUpdateTime()).add(rewardsDuration)
    );
  });

  it("staking correctly adjusts the reward rate and finish time", async () => {
    const reward = BigNumber.from(10).pow(18).mul(100);
    await rewardsToken.connect(signers[0]).transfer(stakingRewards.address, reward);
    await stakingRewards.connect(signers[0]).notifyRewardAmount(reward);

    const stakeAmount = BigNumber.from(1e5);

    const initialRewardRate = await stakingRewards.rewardRate();
    const initialPeriodFinish = await stakingRewards.periodFinish();

    await stakingToken.connect(signers[0]).transfer(signers[1].address, stakeAmount);
    await stakingToken.connect(signers[1]).approve(stakingRewards.address, stakeAmount);
    await stakingRewards.connect(signers[1]).stake(stakeAmount);

    // First staking does not change anything
    expect(await stakingRewards.rewardRate()).to.eq(initialRewardRate);
    expect(await stakingRewards.periodFinish()).to.eq(initialPeriodFinish);

    await mineBlock(ethers.provider, (await stakingRewards.lastStakeTime()).add(daysToTimestamp(1)));

    await stakingToken.connect(signers[0]).transfer(signers[2].address, stakeAmount);
    await stakingToken.connect(signers[2]).approve(stakingRewards.address, stakeAmount);
    await stakingRewards.connect(signers[2]).stake(stakeAmount);

    const newRewardRate = await stakingRewards.rewardRate();
    const newPeriodFinish = await stakingRewards.periodFinish();

    // Further staking adjusts the reward rate and updates the rewards duration
    expect(newRewardRate).to.not.eq(initialRewardRate);
    expect(newPeriodFinish).to.not.eq(initialPeriodFinish);

    await stakingToken.connect(signers[0]).transfer(signers[3].address, stakeAmount);
    await stakingToken.connect(signers[3]).approve(stakingRewards.address, stakeAmount);
    await stakingRewards.connect(signers[3]).stake(stakeAmount);

    await mineBlock(ethers.provider, (await stakingRewards.lastStakeTime()).add(daysToTimestamp(1)).sub(1));

    // However, the adjustment can occur at most once per day
    expect(await stakingRewards.rewardRate()).to.eq(newRewardRate);
    expect(await stakingRewards.periodFinish()).to.eq(newPeriodFinish);
  });
});
