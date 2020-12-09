import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { ethers } from "hardhat";

import { AppToken } from "../typechain/AppToken";
import { AppTokenManager } from "../typechain/AppTokenManager";
import { RewardsEscrow } from "../typechain/RewardsEscrow";
import { StakingRewards } from "../typechain/StakingRewards";
import { TestErc20 } from "../typechain/TestErc20";
import {
  bn,
  createAppToken,
  daysToTimestamp,
  deployContract,
  expandTo18Decimals,
  getEvent,
  mineBlock,
  mineBlocks
} from "./utils";

chai.use(solidity);
const { expect } = chai;

describe("StakingRewards", () => {
  let deployer: SignerWithAddress;
  let rewardsDistribution: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;
  let carol: SignerWithAddress;
  
  let appTokenManager: AppTokenManager;
  let rewardsToken: TestErc20;
  let stakingToken: TestErc20;
  let rewardsEscrow: RewardsEscrow;
  let stakingRewards: StakingRewards;

  const REWARDS_TOKEN_NAME = "App Token";
  const REWARDS_TOKEN_SYMBOL = "APPTKN";
  const REWARDS_TOKEN_AMOUNT = expandTo18Decimals(1000);

  const STAKING_TOKEN_NAME = "Props Token";
  const STAKING_TOKEN_SYMBOL = "PROPS";
  const STAKING_TOKEN_AMOUNT = expandTo18Decimals(1000);

  const REWARDS_ESCROW_LOCK_DURATION = bn(100);

  // Corresponds to 0.0003658 - taken from old Props rewards formula
  // Distributes 12.5% of the remaining rewards pool each year
  const STAKING_REWARDS_DAILY_EMISSION = bn(3658).mul(1e11);

  beforeEach(async () => {
    [deployer, rewardsDistribution, alice, bob, carol, ] = await ethers.getSigners();

    const appTokenLogic: AppToken = await deployContract("AppToken", deployer);
    appTokenManager = await deployContract(
      "AppTokenManager",
      deployer,
      appTokenLogic.address // _implementationContract
    );

    rewardsToken = await createAppToken(
      appTokenManager,
      REWARDS_TOKEN_NAME,          // name
      REWARDS_TOKEN_SYMBOL,        // symbol
      REWARDS_TOKEN_AMOUNT,        // amount
      rewardsDistribution.address, // owner
      rewardsDistribution.address  // propsOwner
    );

    stakingToken = await deployContract(
      "TestERC20",
      deployer,
      STAKING_TOKEN_NAME,   // name
      STAKING_TOKEN_SYMBOL, // symbol
      STAKING_TOKEN_AMOUNT  // amount
    );

    rewardsEscrow = await deployContract(
      "RewardsEscrow",
      deployer,
      rewardsToken.address,        // _rewardsToken
      REWARDS_ESCROW_LOCK_DURATION // _lockDuration
    );

    stakingRewards = await deployContract(
      "StakingRewards",
      deployer,
      rewardsDistribution.address,   // rewardsDistribution
      rewardsToken.address,          // rewardsToken
      stakingToken.address,          // stakingToken
      rewardsEscrow.address,         // rewardsEscrow
      STAKING_REWARDS_DAILY_EMISSION // dailyEmission
    );
  });

  it("distributing new rewards correctly sets different parameters", async () => {
    const reward = expandTo18Decimals(100);

    // Distribute rewards
    await rewardsToken.connect(rewardsDistribution).transfer(stakingRewards.address, reward);
    await stakingRewards.connect(rewardsDistribution).notifyRewardAmount(reward);

    // The rewards duration is correct
    const rewardsDuration = await stakingRewards.rewardsDuration();
    expect(rewardsDuration).to.eq(
      expandTo18Decimals(1).div(STAKING_REWARDS_DAILY_EMISSION).mul(24).mul(3600)
    );

    // The reward rate is correct
    const rewardRate = await stakingRewards.rewardRate();
    expect(rewardRate).to.eq(reward.div(rewardsDuration));

    // The rewards distribution finish time is correct
    expect(await stakingRewards.periodFinish()).to.eq(
      (await stakingRewards.lastUpdateTime()).add(rewardsDuration)
    );
  });

  it("staking correctly adjusts the reward rate and finish time", async () => {
    const reward = expandTo18Decimals(100);

    // Distribute rewards
    await rewardsToken.connect(rewardsDistribution).transfer(stakingRewards.address, reward);
    await stakingRewards.connect(rewardsDistribution).notifyRewardAmount(reward);

    const stakeAmount = bn(100000);

    const initialRewardRate = await stakingRewards.rewardRate();
    const initialPeriodFinish = await stakingRewards.periodFinish();

    // First stake
    await stakingToken.connect(deployer).transfer(alice.address, stakeAmount);
    await stakingToken.connect(alice).approve(stakingRewards.address, stakeAmount);
    await stakingRewards.connect(alice).stake(stakeAmount);

    // First stake does not change anything
    expect(await stakingRewards.rewardRate()).to.eq(initialRewardRate);
    expect(await stakingRewards.periodFinish()).to.eq(initialPeriodFinish);

    // Fast forward until one day after the last stake
    await mineBlock((await stakingRewards.lastStakeTime()).add(daysToTimestamp(1)));

    // Second stake
    await stakingToken.connect(deployer).transfer(bob.address, stakeAmount);
    await stakingToken.connect(bob).approve(stakingRewards.address, stakeAmount);
    await stakingRewards.connect(bob).stake(stakeAmount);

    const newRewardRate = await stakingRewards.rewardRate();
    const newPeriodFinish = await stakingRewards.periodFinish();

    // Further staking adjusts the reward rate and updates the rewards duration
    expect(newRewardRate).to.not.eq(initialRewardRate);
    expect(newPeriodFinish).to.not.eq(initialPeriodFinish);

    // Third stake
    await stakingToken.connect(deployer).transfer(carol.address, stakeAmount);
    await stakingToken.connect(carol).approve(stakingRewards.address, stakeAmount);
    await stakingRewards.connect(carol).stake(stakeAmount);

    // Fast forward until just before one day after the last stake
    await mineBlock((await stakingRewards.lastStakeTime()).add(daysToTimestamp(1)).sub(1));

    // The reward parameters adjustments can occur at most once per day
    expect(await stakingRewards.rewardRate()).to.eq(newRewardRate);
    expect(await stakingRewards.periodFinish()).to.eq(newPeriodFinish);
  });

  it("claimed rewards get sent to the rewards escrow", async () => {
    const reward = expandTo18Decimals(100);

    // Distribute rewards
    await rewardsToken.connect(rewardsDistribution).transfer(stakingRewards.address, reward);
    await stakingRewards.connect(rewardsDistribution).notifyRewardAmount(reward);

    const stakeAmount = bn(100000);

    // Stake
    await stakingToken.connect(deployer).transfer(alice.address, stakeAmount);
    await stakingToken.connect(alice).approve(stakingRewards.address, stakeAmount);
    await stakingRewards.connect(alice).stake(stakeAmount);

    // Fast forward
    await mineBlock((await stakingRewards.lastStakeTime()).add(daysToTimestamp(356)));

    // Claim rewards
    const tx = await stakingRewards.connect(alice).getReward();

    const txReceipt = await tx.wait();

    // Check that the claimed rewards are locked in the rewards escrow
    const [, earnedReward] = await getEvent(txReceipt, "RewardPaid(address,uint256)", "StakingRewards");
    expect(await rewardsToken.balanceOf(alice.address)).to.eq(bn(0));
    expect(await rewardsEscrow.lockedBalanceOf(alice.address)).to.eq(earnedReward);

    const [,, lockBlock, unlockBlock] = await getEvent(
      txReceipt,
      "Locked(address,uint256,uint256,uint256)",
      "RewardsEscrow"
    );

    // Fast forward until after the rewards time lock
    await mineBlocks(unlockBlock.sub(lockBlock).add(1));

    // Unlock the rewards and check that it succeeded
    await rewardsEscrow.unlock(alice.address, [lockBlock]);
    expect(await rewardsToken.balanceOf(alice.address)).to.eq(earnedReward);
    expect(await rewardsEscrow.lockedBalanceOf(alice.address)).to.eq(bn(0));
  });
});
