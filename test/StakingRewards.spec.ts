import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { ethers } from "hardhat";

import { AppToken } from "../typechain/AppToken";
import { AppTokenManager } from "../typechain/AppTokenManager";
import { StakingRewards } from "../typechain/StakingRewards";
import { TestLockableErc20 } from "../typechain/TestLockableErc20";
import {
  bn,
  createAppToken,
  daysToTimestamp,
  deployContract,
  expandTo18Decimals,
  getDirectEvent,
  getIndirectEvent,
  mineBlock
} from "./utils";

chai.use(solidity);
const { expect } = chai;

const REWARDS_TOKEN_NAME = "App Token";
const REWARDS_TOKEN_SYMBOL = "APPTKN";
const REWARDS_TOKEN_AMOUNT = expandTo18Decimals(1000);

const STAKING_TOKEN_NAME = "Props Token";
const STAKING_TOKEN_SYMBOL = "PROPS";
const STAKING_TOKEN_AMOUNT = expandTo18Decimals(1000);

// Corresponds to 0.0003658 - taken from old Props rewards formula
// Distributes 12.5% of the remaining rewards pool each year
const STAKING_REWARDS_DAILY_EMISSION = bn(3658).mul(1e11);

describe("StakingRewards", () => {
  let signers: SignerWithAddress[];
  
  let appTokenManager: AppTokenManager;
  let rewardsToken: TestLockableErc20;
  let stakingToken: TestLockableErc20;
  let stakingRewards: StakingRewards;

  beforeEach(async () => {
    signers = await ethers.getSigners();

    // TODO: Make app tokens lockable
    // const appTokenLogic: AppToken = await deployContract("AppToken", signers[0]);
    // appTokenManager = await deployContract(
    //   "AppTokenManager",
    //   signers[0],
    //   appTokenLogic.address // _implementationContract
    // );

    // rewardsToken = await createAppToken(
    //   appTokenManager,
    //   REWARDS_TOKEN_NAME,   // name
    //   REWARDS_TOKEN_SYMBOL, // symbol
    //   REWARDS_TOKEN_AMOUNT, // amount
    //   signers[0].address,   // owner
    //   signers[1].address    // propsOwner
    // ) as AppToken;

    rewardsToken = await deployContract(
      "TestLockableERC20",
      signers[0],
      REWARDS_TOKEN_NAME,   // name
      REWARDS_TOKEN_SYMBOL, // symbol
      REWARDS_TOKEN_AMOUNT  // amount
    );

    stakingToken = await deployContract(
      "TestLockableERC20",
      signers[0],
      STAKING_TOKEN_NAME,   // name
      STAKING_TOKEN_SYMBOL, // symbol
      STAKING_TOKEN_AMOUNT  // amount
    );

    stakingRewards = await deployContract(
      "StakingRewards",
      signers[0],
      signers[0].address,   // rewardsDistribution
      rewardsToken.address, // rewardsToken
      stakingToken.address, // stakingToken
      STAKING_REWARDS_DAILY_EMISSION // dailyEmission
    );
  });

  it("distributing new rewards correctly sets different parameters", async () => {
    const reward = expandTo18Decimals(100);

    // Distribute rewards
    await rewardsToken.connect(signers[0]).transfer(stakingRewards.address, reward);
    await stakingRewards.connect(signers[0]).notifyRewardAmount(reward);

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
    await rewardsToken.connect(signers[0]).transfer(stakingRewards.address, reward);
    await stakingRewards.connect(signers[0]).notifyRewardAmount(reward);

    const stakeAmount = bn(100000);

    const initialRewardRate = await stakingRewards.rewardRate();
    const initialPeriodFinish = await stakingRewards.periodFinish();

    // First stake
    await stakingToken.connect(signers[0]).transfer(signers[1].address, stakeAmount);
    await stakingToken.connect(signers[1]).approve(stakingRewards.address, stakeAmount);
    await stakingRewards.connect(signers[1]).stake(stakeAmount);

    // First stake does not change anything
    expect(await stakingRewards.rewardRate()).to.eq(initialRewardRate);
    expect(await stakingRewards.periodFinish()).to.eq(initialPeriodFinish);

    // Fast forward until one day after the last stake
    await mineBlock((await stakingRewards.lastStakeTime()).add(daysToTimestamp(1)));

    // Second stake
    await stakingToken.connect(signers[0]).transfer(signers[2].address, stakeAmount);
    await stakingToken.connect(signers[2]).approve(stakingRewards.address, stakeAmount);
    await stakingRewards.connect(signers[2]).stake(stakeAmount);

    const newRewardRate = await stakingRewards.rewardRate();
    const newPeriodFinish = await stakingRewards.periodFinish();

    // Further staking adjusts the reward rate and updates the rewards duration
    expect(newRewardRate).to.not.eq(initialRewardRate);
    expect(newPeriodFinish).to.not.eq(initialPeriodFinish);

    // Third stake
    await stakingToken.connect(signers[0]).transfer(signers[3].address, stakeAmount);
    await stakingToken.connect(signers[3]).approve(stakingRewards.address, stakeAmount);
    await stakingRewards.connect(signers[3]).stake(stakeAmount);

    // Fast forward until just before one day after the last stake
    await mineBlock((await stakingRewards.lastStakeTime()).add(daysToTimestamp(1)).sub(1));

    // The reward parameters adjustments can occur at most once per day
    expect(await stakingRewards.rewardRate()).to.eq(newRewardRate);
    expect(await stakingRewards.periodFinish()).to.eq(newPeriodFinish);
  });

  it("rewards are under a lock period before they get in the possesion of the staker", async () => {
    const reward = expandTo18Decimals(100);

    // Distribute rewards
    await rewardsToken.connect(signers[0]).transfer(stakingRewards.address, reward);
    await stakingRewards.connect(signers[0]).notifyRewardAmount(reward);

    const stakeAmount = bn(100000);

    // Stake
    await stakingToken.connect(signers[0]).transfer(signers[1].address, stakeAmount);
    await stakingToken.connect(signers[1]).approve(stakingRewards.address, stakeAmount);
    await stakingRewards.connect(signers[1]).stake(stakeAmount);

    // Fast forward
    await mineBlock((await stakingRewards.lastStakeTime()).add(daysToTimestamp(356)));

    // Claim rewards
    const tx = await stakingRewards.connect(signers[1]).getReward();

    const txReceipt = await tx.wait();

    // Check that the claimed rewards are locked
    const [, earnedReward] = getDirectEvent(txReceipt, "RewardPaid(address,uint256)");
    expect(await rewardsToken.balanceOf(signers[1].address)).to.eq(bn(0));
    expect(await rewardsToken.totalBalanceOf(signers[1].address)).to.eq(earnedReward);

    const [,, lockTime, unlockTime] = getIndirectEvent(
      txReceipt,
      "Locked(address,uint256,uint256,uint256)",
      (await ethers.getContractFactory("TestLockableERC20")).interface
    );

    // Fast forward until after the unlock time
    await mineBlock(unlockTime.add(1));

    // Unlock the rewards and check that it succeeded
    await rewardsToken.unlock(signers[1].address, [lockTime]);
    expect(await rewardsToken.balanceOf(signers[1].address)).to.eq(earnedReward);
    expect(await rewardsToken.totalBalanceOf(signers[1].address)).to.eq(earnedReward);
  });
});
