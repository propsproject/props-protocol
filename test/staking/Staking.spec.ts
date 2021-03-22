import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { BigNumber } from "ethers";
import { ethers } from "hardhat";

import type { Staking, MockErc20 } from "../../typechain";
import {
  bn,
  daysToTimestamp,
  deployContractUpgradeable,
  expandTo18Decimals,
  getTxTimestamp,
  mineBlock,
} from "../../utils";

chai.use(solidity);
const { expect } = chai;

describe("Staking", () => {
  let deployer: SignerWithAddress;
  let controller: SignerWithAddress;
  let rewardsDistribution: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;
  let carol: SignerWithAddress;

  let rewardsToken: MockErc20;
  let staking: Staking;

  const REWARDS_TOKEN_NAME = "Rewards";
  const REWARDS_TOKEN_SYMBOL = "RWD";
  const REWARDS_TOKEN_AMOUNT = expandTo18Decimals(1000);

  // Corresponds to 0.0003658 - taken from old Props rewards formula
  // Distributes 12.5% of the remaining rewards pool each year
  const DAILY_REWARDS_EMISSION = bn(3658).mul(1e11);

  beforeEach(async () => {
    [deployer, controller, rewardsDistribution, alice, bob, carol] = await ethers.getSigners();

    rewardsToken = await deployContractUpgradeable(
      "MockERC20",
      rewardsDistribution,
      REWARDS_TOKEN_NAME,
      REWARDS_TOKEN_SYMBOL,
      REWARDS_TOKEN_AMOUNT
    );

    staking = await deployContractUpgradeable(
      "Staking",
      deployer,
      controller.address,
      rewardsDistribution.address,
      rewardsToken.address,
      DAILY_REWARDS_EMISSION
    );
  });

  it("distributing new rewards correctly sets different parameters", async () => {
    const reward = expandTo18Decimals(100);

    // Distribute reward
    await rewardsToken.connect(rewardsDistribution).transfer(staking.address, reward);
    await staking.connect(rewardsDistribution).notifyRewardAmount(reward);

    // The rewards duration is correctly set
    const rewardsDuration = await staking.rewardsDuration();
    expect(rewardsDuration).to.eq(
      expandTo18Decimals(1).mul(daysToTimestamp(1)).div(DAILY_REWARDS_EMISSION)
    );

    // The reward rate is correctly set
    const rewardRate = await staking.rewardRate();
    expect(rewardRate).to.eq(reward.div(rewardsDuration));

    // The rewards distribution finish time is correctly set
    expect(await staking.periodFinish()).to.eq(
      (await staking.lastUpdateTime()).add(rewardsDuration)
    );
  });

  it("staking adjusts the reward rate and rewards period finish time", async () => {
    let leftover: BigNumber;

    const rewardsDuration = await staking.rewardsDuration();
    const reward = expandTo18Decimals(100);
    const stakeAmount = expandTo18Decimals(10);

    // Distribute reward
    await rewardsToken.connect(rewardsDistribution).transfer(staking.address, reward);
    await staking.connect(rewardsDistribution).notifyRewardAmount(reward);

    const firstRewardRate = await staking.rewardRate();
    const firstPeriodFinish = await staking.periodFinish();

    // First stake
    await staking.connect(controller).stake(alice.address, stakeAmount);

    // Check the total staked amount
    expect(await staking.totalSupply()).to.eq(stakeAmount);

    // First stake does not change anything
    expect(await staking.rewardRate()).to.eq(firstRewardRate);
    expect(await staking.periodFinish()).to.eq(firstPeriodFinish);

    // Fast-forward until just after one day after the last reward rate update
    await mineBlock((await staking.lastRewardRateUpdate()).add(daysToTimestamp(1)).add(1));

    // Second stake
    const secondStakeTime = await getTxTimestamp(
      await staking.connect(controller).stake(bob.address, stakeAmount)
    );

    // Check the total staked amount
    expect(await staking.totalSupply()).to.eq(stakeAmount.mul(2));

    const secondRewardRate = await staking.rewardRate();
    const secondPeriodFinish = await staking.periodFinish();

    // Further staking adjusts the reward rate and rewards period finish time
    leftover = firstPeriodFinish.sub(secondStakeTime).mul(firstRewardRate);
    expect(secondRewardRate).to.eq(leftover.div(rewardsDuration));
    expect(secondPeriodFinish).to.eq(secondStakeTime.add(rewardsDuration));

    // Fast-forward until ~half day after the last reward rate update
    await mineBlock((await staking.lastRewardRateUpdate()).add(daysToTimestamp(1).div(2)));

    // Third stake
    await staking.connect(controller).stake(carol.address, stakeAmount);

    // Check the total staked amount
    expect(await staking.totalSupply()).to.eq(stakeAmount.mul(3));

    // However, the reward parameters adjustments can occur at most once per day
    expect(await staking.rewardRate()).to.eq(secondRewardRate);
    expect(await staking.periodFinish()).to.eq(secondPeriodFinish);

    // Fast-forward until just after one day after the last reward rate update
    await mineBlock((await staking.lastRewardRateUpdate()).add(daysToTimestamp(1)).add(1));

    // Fourth stake
    const fourthStakeTime = await getTxTimestamp(
      await staking.connect(controller).stake(carol.address, stakeAmount)
    );

    // Check the total staked amount
    expect(await staking.totalSupply()).to.eq(stakeAmount.mul(4));

    // Once one day since the last reward rate update passed, the parameters get readjusted
    leftover = secondPeriodFinish.sub(fourthStakeTime).mul(secondRewardRate);
    expect(await staking.rewardRate()).to.eq(leftover.div(rewardsDuration));
    expect(await staking.periodFinish()).to.eq(fourthStakeTime.add(rewardsDuration));
  });

  it("proper permissioning", async () => {
    const stakeAmount = expandTo18Decimals(100);

    // Only the owner can stake
    await expect(staking.connect(alice).stake(alice.address, stakeAmount)).to.be.revertedWith(
      "Unauthorized"
    );
    await staking.connect(controller).stake(alice.address, stakeAmount);

    // Only the owner can withdraw
    await expect(staking.connect(alice).withdraw(alice.address, stakeAmount)).to.be.revertedWith(
      "Unauthorized"
    );
    await staking.connect(controller).withdraw(alice.address, stakeAmount);

    // Only the owner can claim rewards
    await expect(staking.connect(alice).claimReward(alice.address)).to.be.revertedWith(
      "Unauthorized"
    );
    await staking.connect(controller).claimReward(alice.address);

    // Only the rewards distribution can distribute new rewards
    await expect(
      staking.connect(controller).notifyRewardAmount(expandTo18Decimals(100))
    ).to.be.revertedWith("Unauthorized");
    await rewardsToken.connect(rewardsDistribution).transfer(staking.address, stakeAmount);
    await staking.connect(rewardsDistribution).notifyRewardAmount(expandTo18Decimals(100));

    // Only the rewards distribution can withdraw outstanding rewards
    await expect(
      staking.connect(controller).withdrawReward(expandTo18Decimals(10))
    ).to.be.revertedWith("Unauthorized");
    await staking.connect(rewardsDistribution).withdrawReward(expandTo18Decimals(10));

    // Only the rewards distribution can change the daily emission rate
    await expect(
      staking.connect(controller).changeDailyRewardEmission(DAILY_REWARDS_EMISSION.add(1))
    ).to.be.revertedWith("Unauthorized");
    await staking
      .connect(rewardsDistribution)
      .changeDailyRewardEmission(DAILY_REWARDS_EMISSION.add(1));
  });

  it("distribute new rewards during on-going reward period", async () => {
    const firstReward = expandTo18Decimals(100);
    const secondReward = expandTo18Decimals(100);

    const rewardsDuration = await staking.rewardsDuration();

    // Distribute first reward
    await rewardsToken.connect(rewardsDistribution).transfer(staking.address, firstReward);
    const firstDistributionStartTime = await getTxTimestamp(
      await staking.connect(rewardsDistribution).notifyRewardAmount(firstReward)
    );

    const firstRewardRate = await staking.rewardRate();
    const firstPeriodFinish = await staking.periodFinish();

    // Check the reward parameters were properly set
    expect(firstRewardRate).to.eq(firstReward.div(rewardsDuration));
    expect(firstPeriodFinish).to.eq(firstDistributionStartTime.add(rewardsDuration));

    // Fast-forward until ~half of the reward period
    await mineBlock(firstDistributionStartTime.add(rewardsDuration.div(2)));

    // Distribute second reward
    await rewardsToken.connect(rewardsDistribution).transfer(staking.address, secondReward);
    const secondDistributionStartTime = await getTxTimestamp(
      await staking.connect(rewardsDistribution).notifyRewardAmount(secondReward)
    );

    // Check the new rewards were properly accounted for
    // remainingRewardsToDistribute = (firstPeriodFinish - secondDistributionTime) * oldRewardRate
    // (remainingRewardsToDistribute + secondReward) / rewardsDuration
    expect(await staking.rewardRate()).to.eq(
      firstPeriodFinish
        .sub(secondDistributionStartTime)
        .mul(firstRewardRate)
        .add(secondReward)
        .div(rewardsDuration)
    );
    expect(await staking.periodFinish()).to.eq(secondDistributionStartTime.add(rewardsDuration));
  });

  it("rewards are properly distributed to stakers (single staker)", async () => {
    const reward = expandTo18Decimals(100);
    const stakeAmount = expandTo18Decimals(10);

    // Distribute reward
    await rewardsToken.connect(rewardsDistribution).transfer(staking.address, reward);
    await staking.connect(rewardsDistribution).notifyRewardAmount(reward);

    // First stake
    await staking.connect(controller).stake(alice.address, stakeAmount);

    // Fast-forward until the end of the rewards period
    await mineBlock((await staking.periodFinish()).add(1));

    // Check that the only staker got all rewards (ensure results are within .01%)
    const earned = await staking.earned(alice.address);
    expect(reward.sub(earned).abs().lte(reward.div(10000))).to.be.true;

    // Claim rewards and check that the rewards are transferred to the controller (ensure results are within .01%)
    await staking.connect(controller).claimReward(alice.address);
    expect(
      (await rewardsToken.balanceOf(controller.address)).sub(earned).abs().lte(earned.div(10000))
    ).to.be.true;
  });

  it("rewards are properly distributed to stakers (two stakers)", async () => {
    const rewardsDuration = await staking.rewardsDuration();
    const reward = expandTo18Decimals(100);
    const stakeAmount = expandTo18Decimals(10);

    // Distribute reward
    await rewardsToken.connect(rewardsDistribution).transfer(staking.address, reward);
    const distributionStartTime = await getTxTimestamp(
      await staking.connect(rewardsDistribution).notifyRewardAmount(reward)
    );

    const firstRewardRate = await staking.rewardRate();

    // First stake
    await staking.connect(controller).stake(alice.address, stakeAmount);

    // Fast-forward until ~middle of the rewards period
    await mineBlock(distributionStartTime.add(rewardsDuration.div(2)));

    // Second stake (will trigger a reward rate update)
    const secondStakeTime = await getTxTimestamp(
      await staking.connect(controller).stake(bob.address, stakeAmount)
    );

    const secondRewardRate = await staking.rewardRate();

    // Fast-forward until the end of the rewards period
    await mineBlock((await staking.periodFinish()).add(1));

    // Check Alice's rewards (ensure results are within .01%)
    // firstPeriodEarned = (secondStakeTime - distributionStartTime) * firstRewardRate
    // secondPeriodEarned = ((periodFinish - secondStakeTime) * secondRewardRate) * aliceStakedAmount / totalStakedAmount
    // firstPeriodEarned + secondPeriodEarned
    const aliceEarned = await staking.earned(alice.address);
    const localAliceEarned = secondStakeTime
      .sub(distributionStartTime)
      .mul(firstRewardRate)
      .add((await staking.periodFinish()).sub(secondStakeTime).mul(secondRewardRate).div(2));
    expect(aliceEarned.sub(localAliceEarned).abs().lte(aliceEarned.div(10000))).to.be.true;

    // Check Bob's rewards (ensure results are within .01%)
    // ((periodFinish - secondStakeTime) * secondRewardRate) * bobStakedAmount / totalStakedAmount
    const bobEarned = await staking.earned(bob.address);
    const localBobEarned = (await staking.periodFinish())
      .sub(secondStakeTime)
      .mul(secondRewardRate)
      .div(2);
    expect(bobEarned.sub(localBobEarned).abs().lte(bobEarned.div(10000))).to.be.true;
  });

  it("rewards are properly distributed to stakers (three stakers with unstaking)", async () => {
    const rewardsDuration = await staking.rewardsDuration();
    const reward = expandTo18Decimals(100);
    const stakeAmount = expandTo18Decimals(10);

    // Distribute reward
    await rewardsToken.connect(rewardsDistribution).transfer(staking.address, reward);
    const distributionStartTime = await getTxTimestamp(
      await staking.connect(rewardsDistribution).notifyRewardAmount(reward)
    );

    const firstRewardRate = await staking.rewardRate();

    // First stake
    await staking.connect(controller).stake(alice.address, stakeAmount.mul(2));

    // Fast-forward until ~middle of the rewards period
    await mineBlock(distributionStartTime.add(rewardsDuration.div(2)));

    // Second stake (will trigger a reward rate update and extend the rewards period)
    const secondStakeTime = await getTxTimestamp(
      await staking.connect(controller).stake(bob.address, stakeAmount)
    );

    const secondRewardRate = await staking.rewardRate();

    // Fast-forward until ~middle of the rewards period
    await mineBlock(secondStakeTime.add(rewardsDuration.div(2)));

    // Fully unstake with Alice
    const unstakeTime = await getTxTimestamp(
      await staking.connect(controller).withdraw(alice.address, stakeAmount.mul(2))
    );

    // Third stake
    const thirdStakeTime = await getTxTimestamp(
      await staking.connect(controller).stake(carol.address, stakeAmount)
    );

    const thirdRewardRate = await staking.rewardRate();

    // Fast-forward until the end of the rewards period
    await mineBlock((await staking.periodFinish()).add(1));

    // Check Alice's rewards (ensure results are within .01%)
    // firstPeriodEarned = (secondStakeTime - distributionStartTime) * firstRewardRate
    // secondPeriodEarned = ((unstakeTime - secondStakeTime) * secondRewardRate) * aliceStakedAmount / totalStakedAmount
    // firstPeriodEarned + secondPeriodEarned
    const aliceEarned = await staking.earned(alice.address);
    const localAliceEarned = secondStakeTime
      .sub(distributionStartTime)
      .mul(firstRewardRate)
      .add(unstakeTime.sub(secondStakeTime).mul(secondRewardRate).mul(2).div(3));
    expect(aliceEarned.sub(localAliceEarned).abs().lte(aliceEarned.div(10000))).to.be.true;

    // Check Bob's rewards (ensure results are within .01%)
    // secondPeriodEarned = ((thirdStakeTime - secondStakeTime) * secondRewardRate) * bobStakedAmount / totalStakedAmount
    // thirdPeriodEarned = ((periodFinish - thirdStakeTime) * thirdRewardRate) * bobStakedAmount / totalStakedAmount
    // secondPeriodEarned + thirdPeriodEarned
    const bobEarned = await staking.earned(bob.address);
    const localBobEarned = thirdStakeTime
      .sub(secondStakeTime)
      .mul(secondRewardRate)
      .div(3)
      .add((await staking.periodFinish()).sub(thirdStakeTime).mul(thirdRewardRate).div(2));
    expect(bobEarned.sub(localBobEarned).abs().lte(bobEarned.div(10000))).to.be.true;

    // Check Carol's rewards (ensure results are within .01%)
    // ((periodFinish - thirdStakeTime) * thirdRewardRate) * carolStakedAmount / totalStakedAmount
    const carolEarned = await staking.earned(carol.address);
    const localCarolEarned = (await staking.periodFinish())
      .sub(thirdStakeTime)
      .mul(thirdRewardRate)
      .div(2);
    expect(carolEarned.sub(localCarolEarned).abs().lte(carolEarned.div(10000))).to.be.true;
  });

  it("withdraw not yet distributed rewards during an on-going rewards period", async () => {
    const rewardsDuration = await staking.rewardsDuration();
    const reward = expandTo18Decimals(1000);
    const stakeAmount = expandTo18Decimals(10);

    // Distribute reward
    await rewardsToken.connect(rewardsDistribution).transfer(staking.address, reward);
    const distributionStartTime = await getTxTimestamp(
      await staking.connect(rewardsDistribution).notifyRewardAmount(reward)
    );

    const firstRewardRate = await staking.rewardRate();

    // First stake
    await staking.connect(controller).stake(alice.address, stakeAmount);

    // Fast-forward until ~middle of the rewards period
    await mineBlock(distributionStartTime.add(rewardsDuration.div(2)));

    // Cannot withdraw rewards that were distributed or doesn't exist
    await expect(staking.connect(rewardsDistribution).withdrawReward(reward)).to.be.revertedWith(
      "Amount exceeds outstanding rewards"
    );

    // Withdraw some amount of not yet distributed rewards
    const withdrawTime = await getTxTimestamp(
      await staking.connect(rewardsDistribution).withdrawReward(reward.div(10))
    );

    const secondRewardRate = await staking.rewardRate();
    const periodFinish = await staking.periodFinish();

    // Fast-forward until after the end of the rewards period
    await mineBlock(periodFinish.add(daysToTimestamp(1)));

    // Check that the only staker earned the correct amount (ensure results are within .01%)
    // firstPeriodEarned = (withdrawTime - distributionStartTime) * firstRewardRate
    // secondPeriodEarned = (periodFinish - withdrawTime) * secondRewardRate
    // firstPeriodEarned + secondPeriodEarned
    const earned = await staking.earned(alice.address);
    const localEarned = firstRewardRate
      .mul(withdrawTime.sub(distributionStartTime))
      .add(secondRewardRate.mul(periodFinish.sub(withdrawTime)));
    expect(earned.sub(localEarned).abs().lte(earned.div(10000))).to.be.true;
    expect(earned.lte(await rewardsToken.balanceOf(staking.address)));

    // Check that the correct amount of rewards was withdrawn
    expect(reward.div(10)).to.eq(await rewardsToken.balanceOf(rewardsDistribution.address));
  });

  it("update the daily reward emission rate", async () => {
    const reward = expandTo18Decimals(1000);

    const initialRewardsDuration = await staking.rewardsDuration();

    // Distribute reward
    await rewardsToken.connect(rewardsDistribution).transfer(staking.address, reward);
    await staking.connect(rewardsDistribution).notifyRewardAmount(reward);

    const initialRewardRate = await staking.rewardRate();

    // Change the daily reward emission rate
    await staking
      .connect(rewardsDistribution)
      .changeDailyRewardEmission(DAILY_REWARDS_EMISSION.div(2));

    // Check that the new emission rate only changed the rewards duration
    expect((await staking.rewardsDuration()).gt(initialRewardsDuration)).to.be.true;
    expect(await staking.rewardRate()).to.eq(initialRewardRate);
  });

  it("transfer rewards distribution role", async () => {
    const reward = expandTo18Decimals(1000);
    await rewardsToken.connect(rewardsDistribution).transfer(staking.address, reward);

    // Update the rewards distribution address
    await staking.connect(rewardsDistribution).changeRewardsDistribution(alice.address);
    await expect(
      staking.connect(rewardsDistribution).notifyRewardAmount(reward)
    ).to.be.revertedWith("Unauthorized");
    await staking.connect(alice).notifyRewardAmount(reward);
  });
});
