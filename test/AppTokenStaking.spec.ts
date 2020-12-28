import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { BigNumber } from "ethers";
import { ethers } from "hardhat";

import type { AppTokenStaking, TestErc20 } from "../typechain";
import {
  bn,
  daysToTimestamp,
  deployContractUpgradeable,
  expandTo18Decimals,
  getTxTimestamp,
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

  const REWARDS_TOKEN_NAME = "AppToken";
  const REWARDS_TOKEN_SYMBOL = "AppToken";
  const REWARDS_TOKEN_AMOUNT = expandTo18Decimals(1000);

  const STAKING_TOKEN_NAME = "Props";
  const STAKING_TOKEN_SYMBOL = "Props";
  const STAKING_TOKEN_AMOUNT = expandTo18Decimals(1000);

  // Corresponds to 0.0003658 - taken from old Props rewards formula
  // Distributes 12.5% of the remaining rewards pool each year
  const DAILY_REWARDS_EMISSION = bn(3658).mul(1e11);

  beforeEach(async () => {
    [stakingManager, rewardsDistribution, alice, bob, carol] = await ethers.getSigners();

    rewardsToken = await deployContractUpgradeable("TestERC20", rewardsDistribution, [
      REWARDS_TOKEN_NAME,
      REWARDS_TOKEN_SYMBOL,
      REWARDS_TOKEN_AMOUNT,
    ]);

    stakingToken = await deployContractUpgradeable("TestERC20", stakingManager, [
      STAKING_TOKEN_NAME,
      STAKING_TOKEN_SYMBOL,
      STAKING_TOKEN_AMOUNT,
    ]);

    appTokenStaking = await deployContractUpgradeable("AppTokenStaking", stakingManager, [
      stakingManager.address,
      rewardsDistribution.address,
      rewardsToken.address,
      stakingToken.address,
      DAILY_REWARDS_EMISSION,
    ]);
  });

  it("distributing new rewards correctly sets different parameters", async () => {
    const reward = expandTo18Decimals(100);

    // Distribute reward
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
    let leftover: BigNumber;

    const rewardsDuration = await appTokenStaking.rewardsDuration();
    const reward = expandTo18Decimals(100);
    const stakeAmount = bn(100000);

    // Distribute reward
    await rewardsToken.connect(rewardsDistribution).transfer(appTokenStaking.address, reward);
    await appTokenStaking.connect(rewardsDistribution).notifyRewardAmount(reward);

    const firstRewardRate = await appTokenStaking.rewardRate();
    const firstPeriodFinish = await appTokenStaking.periodFinish();

    // First stake
    await stakingToken.connect(stakingManager).approve(appTokenStaking.address, stakeAmount);
    await appTokenStaking.connect(stakingManager).stake(alice.address, stakeAmount);

    // First stake does not change anything
    expect(await appTokenStaking.rewardRate()).to.eq(firstRewardRate);
    expect(await appTokenStaking.periodFinish()).to.eq(firstPeriodFinish);

    // Fast-forward until just after one day after the last stake
    await mineBlock((await appTokenStaking.lastStakeTime()).add(daysToTimestamp(1)).add(1));

    // Second stake
    await stakingToken.connect(stakingManager).approve(appTokenStaking.address, stakeAmount);
    const secondStakeTime = await getTxTimestamp(
      await appTokenStaking.connect(stakingManager).stake(bob.address, stakeAmount)
    );

    const secondRewardRate = await appTokenStaking.rewardRate();
    const secondPeriodFinish = await appTokenStaking.periodFinish();

    // Further staking adjusts the reward rate and rewards duration
    leftover = firstPeriodFinish.sub(secondStakeTime).mul(firstRewardRate);
    expect(secondRewardRate).to.eq(leftover.div(rewardsDuration));
    expect(secondPeriodFinish).to.eq(secondStakeTime.add(rewardsDuration));

    // Fast-forward until ~half day after the last stake
    await mineBlock((await appTokenStaking.lastStakeTime()).add(daysToTimestamp(1).div(2)));

    // Third stake
    await stakingToken.connect(stakingManager).approve(appTokenStaking.address, stakeAmount);
    await appTokenStaking.connect(stakingManager).stake(carol.address, stakeAmount);

    // However, the reward parameters adjustments can occur at most once per day
    expect(await appTokenStaking.rewardRate()).to.eq(secondRewardRate);
    expect(await appTokenStaking.periodFinish()).to.eq(secondPeriodFinish);

    // Fast-forward until just after one day after the last stake
    await mineBlock((await appTokenStaking.lastStakeTime()).add(daysToTimestamp(1)).add(1));

    // Fourth stake
    await stakingToken.connect(stakingManager).approve(appTokenStaking.address, stakeAmount);
    const fourthStakeTime = await getTxTimestamp(
      await appTokenStaking.connect(stakingManager).stake(carol.address, stakeAmount)
    );

    // Once one day since the last stake passed, the parameters get readjusted
    leftover = secondPeriodFinish.sub(fourthStakeTime).mul(secondRewardRate);
    expect(await appTokenStaking.rewardRate()).to.eq(leftover.div(rewardsDuration));
    expect(await appTokenStaking.periodFinish()).to.eq(fourthStakeTime.add(rewardsDuration));
  });

  it("proper permissioning", async () => {
    const stakeAmount = bn(100);

    // Only the owner can stake
    await expect(
      appTokenStaking.connect(alice).stake(alice.address, stakeAmount)
    ).to.be.revertedWith("Ownable: caller is not the owner");
    await stakingToken.connect(stakingManager).approve(appTokenStaking.address, stakeAmount);
    await appTokenStaking.connect(stakingManager).stake(alice.address, stakeAmount);

    // Only the owner can withdraw
    await expect(
      appTokenStaking.connect(alice).withdraw(alice.address, stakeAmount)
    ).to.be.revertedWith("Ownable: caller is not the owner");
    await appTokenStaking.connect(stakingManager).withdraw(alice.address, stakeAmount);

    // Only the owner can claim rewards
    await expect(appTokenStaking.connect(alice).getReward(alice.address)).to.be.revertedWith(
      "Ownable: caller is not the owner"
    );
    await appTokenStaking.connect(stakingManager).getReward(alice.address);

    // Only the rewards distribution can distribute new rewards (not even the owner can do it)
    await expect(
      appTokenStaking.connect(stakingManager).notifyRewardAmount(bn(100))
    ).to.be.revertedWith("Caller is not RewardsDistribution contract");
    await rewardsToken.connect(rewardsDistribution).transfer(appTokenStaking.address, stakeAmount);
    await appTokenStaking.connect(rewardsDistribution).notifyRewardAmount(bn(100));
  });

  it("rewards are properly distributed to stakers (single staker)", async () => {
    const reward = expandTo18Decimals(100);
    const stakeAmount = bn(100000);

    // Distribute reward
    await rewardsToken.connect(rewardsDistribution).transfer(appTokenStaking.address, reward);
    await appTokenStaking.connect(rewardsDistribution).notifyRewardAmount(reward);

    // First stake
    await stakingToken.connect(stakingManager).approve(appTokenStaking.address, stakeAmount);
    await appTokenStaking.connect(stakingManager).stake(alice.address, stakeAmount);

    // Fast-forward until the end of the rewards period
    await mineBlock((await appTokenStaking.periodFinish()).add(1));

    // Check that the only staker got all rewards (ensure results are within .01%)
    await appTokenStaking.connect(stakingManager).getReward(alice.address);
    const earned = await rewardsToken.balanceOf(alice.address);
    expect(reward.sub(earned).abs().lte(reward.div(10000))).to.be.true;
  });

  it("rewards are properly distributed to stakers (two stakers)", async () => {
    const rewardsDuration = await appTokenStaking.rewardsDuration();
    const reward = expandTo18Decimals(100);
    const stakeAmount = bn(100000);

    // Distribute reward
    await rewardsToken.connect(rewardsDistribution).transfer(appTokenStaking.address, reward);
    const distributionStartTime = await getTxTimestamp(
      await appTokenStaking.connect(rewardsDistribution).notifyRewardAmount(reward)
    );

    const firstRewardRate = await appTokenStaking.rewardRate();

    // First stake
    await stakingToken.connect(stakingManager).approve(appTokenStaking.address, stakeAmount);
    await appTokenStaking.connect(stakingManager).stake(alice.address, stakeAmount);

    // Fast-forward until ~middle of the rewards period
    await mineBlock(distributionStartTime.add(rewardsDuration.div(2)));

    // Second stake (will trigger a reward rate update)
    await stakingToken.connect(stakingManager).approve(appTokenStaking.address, stakeAmount);
    const secondStakeTime = await getTxTimestamp(
      await appTokenStaking.connect(stakingManager).stake(bob.address, stakeAmount)
    );

    const secondRewardRate = await appTokenStaking.rewardRate();

    // Fast-forward until the end of the rewards period
    await mineBlock((await appTokenStaking.periodFinish()).add(1));

    // Check Alice's rewards (ensure results are within .01%)
    await appTokenStaking.connect(stakingManager).getReward(alice.address);
    const aliceEarned = await rewardsToken.balanceOf(alice.address);
    const localAliceEarned = secondStakeTime
      .sub(distributionStartTime)
      .mul(firstRewardRate)
      .add(
        (await appTokenStaking.periodFinish()).sub(secondStakeTime).mul(secondRewardRate).div(2)
      );

    expect(aliceEarned.sub(localAliceEarned).abs().lte(aliceEarned.div(10000))).to.be.true;

    // Check Bob's rewards (ensure results are within .01%)
    await appTokenStaking.connect(stakingManager).getReward(bob.address);
    const bobEarned = await rewardsToken.balanceOf(bob.address);
    const localBobEarned = (await appTokenStaking.periodFinish())
      .sub(secondStakeTime)
      .mul(secondRewardRate)
      .div(2);

    expect(bobEarned.sub(localBobEarned).abs().lte(bobEarned.div(10000))).to.be.true;
  });

  it("rewards are properly distributed to stakers (three stakers with unstaking)", async () => {
    const rewardsDuration = await appTokenStaking.rewardsDuration();
    const reward = expandTo18Decimals(100);
    const stakeAmount = bn(100000);

    // Distribute reward
    await rewardsToken.connect(rewardsDistribution).transfer(appTokenStaking.address, reward);
    const distributionStartTime = await getTxTimestamp(
      await appTokenStaking.connect(rewardsDistribution).notifyRewardAmount(reward)
    );

    const firstRewardRate = await appTokenStaking.rewardRate();

    // First stake
    await stakingToken.connect(stakingManager).approve(appTokenStaking.address, stakeAmount.mul(2));
    await appTokenStaking.connect(stakingManager).stake(alice.address, stakeAmount.mul(2));

    // Fast-forward until ~middle of the rewards period
    await mineBlock(distributionStartTime.add(rewardsDuration.div(2)));

    // Second stake (will trigger a reward rate update and extend the rewards period)
    await stakingToken.connect(stakingManager).approve(appTokenStaking.address, stakeAmount);
    const secondStakeTime = await getTxTimestamp(
      await appTokenStaking.connect(stakingManager).stake(bob.address, stakeAmount)
    );

    const secondRewardRate = await appTokenStaking.rewardRate();

    // Fast-forward until ~middle of the rewards period
    await mineBlock(secondStakeTime.add(rewardsDuration.div(2)));

    // Fully unstake with Alice
    const unstakeTime = await getTxTimestamp(
      await appTokenStaking.connect(stakingManager).withdraw(alice.address, stakeAmount.mul(2))
    );

    // Third stake
    await stakingToken.connect(stakingManager).approve(appTokenStaking.address, stakeAmount);
    const thirdStakeTime = await getTxTimestamp(
      await appTokenStaking.connect(stakingManager).stake(carol.address, stakeAmount)
    );

    const thirdRewardRate = await appTokenStaking.rewardRate();

    // Fast-forward until the end of the rewards period
    await mineBlock((await appTokenStaking.periodFinish()).add(1));

    // Check Alice's rewards (ensure results are within .01%)
    await appTokenStaking.connect(stakingManager).getReward(alice.address);
    const aliceEarned = await rewardsToken.balanceOf(alice.address);
    const localAliceEarned = secondStakeTime
      .sub(distributionStartTime)
      .mul(firstRewardRate)
      .add(unstakeTime.sub(secondStakeTime).mul(secondRewardRate).mul(2).div(3));

    expect(aliceEarned.sub(localAliceEarned).abs().lte(aliceEarned.div(10000))).to.be.true;

    // Check Bob's rewards (ensure results are within .01%)
    await appTokenStaking.connect(stakingManager).getReward(bob.address);
    const bobEarned = await rewardsToken.balanceOf(bob.address);
    const localBobEarned = thirdStakeTime
      .sub(secondStakeTime)
      .mul(secondRewardRate)
      .div(3)
      .add((await appTokenStaking.periodFinish()).sub(thirdStakeTime).mul(thirdRewardRate).div(2));

    expect(bobEarned.sub(localBobEarned).abs().lte(bobEarned.div(10000))).to.be.true;

    // Check Carol's rewards (ensure results are within .01%)
    await appTokenStaking.connect(stakingManager).getReward(carol.address);
    const carolEarned = await rewardsToken.balanceOf(carol.address);
    const localCarolEarned = (await appTokenStaking.periodFinish())
      .sub(thirdStakeTime)
      .mul(thirdRewardRate)
      .div(2);

    expect(carolEarned.sub(localCarolEarned).abs().lte(carolEarned.div(10000))).to.be.true;
  });
});
