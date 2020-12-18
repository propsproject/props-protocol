import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { ethers } from "hardhat";

import type {
  TestErc20,
  SPropsUserStaking
} from "../typechain";
import {
  bn,
  daysToTimestamp,
  deployContract,
  expandTo18Decimals,
  mineBlock,
  now,
} from "./utils";

chai.use(solidity);
const { expect } = chai;

describe("SPropsUserStaking", () => {
  let stakingManager: SignerWithAddress;
  let rewardsDistribution: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;
  let carol: SignerWithAddress;
  
  let rewardsToken: TestErc20;
  let stakingToken: TestErc20;
  let sPropsUserStaking: SPropsUserStaking;

  const REWARDS_TOKEN_NAME = "rProps";
  const REWARDS_TOKEN_SYMBOL = "rProps";
  const REWARDS_TOKEN_AMOUNT = expandTo18Decimals(1000);

  const STAKING_TOKEN_NAME = "sProps";
  const STAKING_TOKEN_SYMBOL = "sProps";
  const STAKING_TOKEN_AMOUNT = expandTo18Decimals(1000);

  // Corresponds to 0.0003658 - taken from old Props rewards formula
  // Distributes 12.5% of the remaining rewards pool each year
  const DAILY_REWARDS_EMISSION = bn(3658).mul(1e11);
  const REWARDS_LOCK_DURATION = daysToTimestamp(365);

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

    sPropsUserStaking = await deployContract("SPropsUserStaking", stakingManager);
    await sPropsUserStaking.connect(stakingManager)
      .initialize(
        rewardsDistribution.address,
        rewardsToken.address,
        stakingToken.address,
        DAILY_REWARDS_EMISSION,
        REWARDS_LOCK_DURATION
      );
  });

  it("rewards cannot be claimed before the maturity date", async () => {
    const reward = expandTo18Decimals(100);

    // Distribute rewards
    await rewardsToken.connect(rewardsDistribution).transfer(sPropsUserStaking.address, reward);
    await sPropsUserStaking.connect(rewardsDistribution).notifyRewardAmount(reward);

    // Stake
    const stakeAmount = bn(100000);
    await stakingToken.connect(stakingManager).transfer(alice.address, stakeAmount);
    await sPropsUserStaking.connect(stakingManager).stake(alice.address);

    // Rewards cannot be claimed before the maturity date
    await expect(sPropsUserStaking.connect(stakingManager).getReward(alice.address)).to.be.reverted;

    // Fast-forward until just before the maturity date and claim rewards
    await mineBlock((await now()).add(REWARDS_LOCK_DURATION).sub(daysToTimestamp(1)));
    await expect(sPropsUserStaking.connect(stakingManager).getReward(alice.address)).to.be.reverted;

    // Fast-forward until just after the maturity date and claim rewards
    await mineBlock((await now()).add(REWARDS_LOCK_DURATION).add(daysToTimestamp(1)));
    await sPropsUserStaking.connect(stakingManager).getReward(alice.address);
  });

  it("rewards are incrementally claimable", async () => {
    const reward = expandTo18Decimals(100);

    // Distribute rewards
    await rewardsToken.connect(rewardsDistribution).transfer(sPropsUserStaking.address, reward);
    await sPropsUserStaking.connect(rewardsDistribution).notifyRewardAmount(reward);

    // Stake
    const stakeAmount = bn(100000);
    await stakingToken.connect(stakingManager).transfer(alice.address, stakeAmount);
    await sPropsUserStaking.connect(stakingManager).stake(alice.address);

    // Fast-forward until just after the maturity date and claim rewards
    await mineBlock((await now()).add(REWARDS_LOCK_DURATION).add(daysToTimestamp(1)));
    await sPropsUserStaking.connect(stakingManager).getReward(alice.address);

    expect((await rewardsToken.balanceOf(alice.address)).lt(await sPropsUserStaking.earned(alice.address)));

    // Fast-forward until some time after the maturity date and claim rewards
    await mineBlock((await now()).add(REWARDS_LOCK_DURATION).add(daysToTimestamp(100)));
    await sPropsUserStaking.connect(stakingManager).getReward(alice.address);

    expect((await rewardsToken.balanceOf(alice.address)).lt(await sPropsUserStaking.earned(alice.address)));

    // Fully exit staking
    await sPropsUserStaking.connect(stakingManager).withdraw(alice.address, stakeAmount);
    await stakingToken.connect(alice).transfer(stakingManager.address, stakeAmount);

    // Fast-forward until after all rewards have matured and claim rewards
    await mineBlock((await now()).add(REWARDS_LOCK_DURATION).add(daysToTimestamp(1)));
    await sPropsUserStaking.connect(stakingManager).getReward(alice.address);

    expect(await rewardsToken.balanceOf(alice.address)).to.eq(await sPropsUserStaking.earned(alice.address));
  });
});
