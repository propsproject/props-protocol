import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { ethers } from "hardhat";

import type { AppTokenStaking, TestErc20 } from "../typechain";
import {
  bn,
  daysToTimestamp,
  deployContract,
  expandTo18Decimals,
  mineBlock,
} from "./utils";

chai.use(solidity);
const { expect } = chai;

describe("AppTokenStaking", () => {
  let stakingManager: SignerWithAddress;
  let rewardsDistribution: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;
  let carol: SignerWithAddress;
  
  let rewardsToken: TestErc20;
  let stakingToken: TestErc20;
  let appTokenStaking: AppTokenStaking;

  const REWARDS_TOKEN_NAME = "Rewards";
  const REWARDS_TOKEN_SYMBOL = "Rewards";
  const REWARDS_TOKEN_AMOUNT = expandTo18Decimals(1000);

  const STAKING_TOKEN_NAME = "Staking";
  const STAKING_TOKEN_SYMBOL = "Staking";
  const STAKING_TOKEN_AMOUNT = expandTo18Decimals(1000);

  // Corresponds to 0.0003658 - taken from old Props rewards formula
  // Distributes 12.5% of the remaining rewards pool each year
  const DAILY_REWARDS_EMISSION = bn(3658).mul(1e11);

  beforeEach(async () => {
    [stakingManager, rewardsDistribution, alice, bob, carol, ] = await ethers.getSigners();

    rewardsToken = await deployContract<TestErc20>(
      "TestERC20",
      rewardsDistribution,
      REWARDS_TOKEN_NAME,
      REWARDS_TOKEN_SYMBOL,
      REWARDS_TOKEN_AMOUNT
    );

    stakingToken = await deployContract<TestErc20>(
      "TestERC20",
      stakingManager,
      STAKING_TOKEN_NAME,
      STAKING_TOKEN_SYMBOL,
      STAKING_TOKEN_AMOUNT
    );

    appTokenStaking = await deployContract("AppTokenStaking", stakingManager);
    await appTokenStaking.connect(stakingManager)
      .initialize(
        rewardsDistribution.address,
        rewardsToken.address,
        stakingToken.address,
        DAILY_REWARDS_EMISSION
      );
  });

  it("distributing new rewards correctly sets different parameters", async () => {
    const reward = expandTo18Decimals(100);

    // Distribute rewards
    await rewardsToken.connect(rewardsDistribution).transfer(appTokenStaking.address, reward);
    await appTokenStaking.connect(rewardsDistribution).notifyRewardAmount(reward);

    // The rewards duration is correctly set
    const rewardsDuration = await appTokenStaking.rewardsDuration();
    expect(rewardsDuration).to.eq(
      expandTo18Decimals(1).div(DAILY_REWARDS_EMISSION).mul(daysToTimestamp(1))
    );

    // The reward rate is correctly set
    const rewardRate = await appTokenStaking.rewardRate();
    expect(rewardRate).to.eq(reward.div(rewardsDuration));

    // The rewards distribution finish time is correctly set
    expect(await appTokenStaking.periodFinish()).to.eq(
      (await appTokenStaking.lastUpdateTime()).add(rewardsDuration)
    );
  });

  it("staking adjusts the reward rate and finish time", async () => {
    const reward = expandTo18Decimals(100);

    // Distribute rewards
    await rewardsToken.connect(rewardsDistribution).transfer(appTokenStaking.address, reward);
    await appTokenStaking.connect(rewardsDistribution).notifyRewardAmount(reward);

    const stakeAmount = bn(100000);

    const initialRewardRate = await appTokenStaking.rewardRate();
    const initialPeriodFinish = await appTokenStaking.periodFinish();

    // First stake
    await stakingToken.connect(stakingManager).approve(appTokenStaking.address, stakeAmount);
    await appTokenStaking.connect(stakingManager).stake(alice.address, stakeAmount);

    // First stake does not change anything
    expect(await appTokenStaking.rewardRate()).to.eq(initialRewardRate);
    expect(await appTokenStaking.periodFinish()).to.eq(initialPeriodFinish);

    // Fast-forward until one day after the last stake
    await mineBlock((await appTokenStaking.lastStakeTime()).add(daysToTimestamp(1)));

    // Second stake
    await stakingToken.connect(stakingManager).approve(appTokenStaking.address, stakeAmount);
    await appTokenStaking.connect(stakingManager).stake(bob.address, stakeAmount);

    const newRewardRate = await appTokenStaking.rewardRate();
    const newPeriodFinish = await appTokenStaking.periodFinish();

    // Further staking adjusts the reward rate and updates the rewards duration
    expect(newRewardRate).to.not.eq(initialRewardRate);
    expect(newPeriodFinish).to.not.eq(initialPeriodFinish);

    // Third stake
    await stakingToken.connect(stakingManager).approve(appTokenStaking.address, stakeAmount);
    await appTokenStaking.connect(stakingManager).stake(carol.address, stakeAmount);

    // Fast-forward until just before one day after the last stake
    await mineBlock((await appTokenStaking.lastStakeTime()).add(daysToTimestamp(1)).sub(1));

    // The reward parameters adjustments can occur at most once per day
    expect(await appTokenStaking.rewardRate()).to.eq(newRewardRate);
    expect(await appTokenStaking.periodFinish()).to.eq(newPeriodFinish);
  });
});