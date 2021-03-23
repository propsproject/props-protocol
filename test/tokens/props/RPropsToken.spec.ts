import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { ethers } from "hardhat";

import type { RPropsToken, PropsTokenL2, Staking } from "../../../typechain";
import {
  bn,
  daysToTimestamp,
  deployContractUpgradeable,
  expandTo18Decimals,
  mineBlock,
  now,
} from "../../../utils";

chai.use(solidity);
const { expect } = chai;

describe("RPropsToken", () => {
  let deployer: SignerWithAddress;
  let controller: SignerWithAddress;
  let alice: SignerWithAddress;
  let mock: SignerWithAddress;

  let propsToken: PropsTokenL2;
  let rPropsToken: RPropsToken;
  let propsAppStaking: Staking;
  let propsUserStaking: Staking;

  const PROPS_TOKEN_AMOUNT = expandTo18Decimals(100000000);
  const RPROPS_TOKEN_AMOUNT = expandTo18Decimals(10000);
  // Corresponds to 0.0003658 - taken from old Props rewards formula
  // Distributes 12.5% of the remaining rewards pool each year
  const DAILY_REWARDS_EMISSION = bn(3658).mul(1e11);

  beforeEach(async () => {
    [deployer, controller, alice, mock] = await ethers.getSigners();

    propsToken = await deployContractUpgradeable("PropsTokenL2", deployer, deployer.address);

    rPropsToken = await deployContractUpgradeable(
      "RPropsToken",
      deployer,
      controller.address,
      propsToken.address
    );

    propsAppStaking = await deployContractUpgradeable(
      "Staking",
      deployer,
      controller.address,
      rPropsToken.address,
      rPropsToken.address,
      DAILY_REWARDS_EMISSION
    );

    propsUserStaking = await deployContractUpgradeable(
      "Staking",
      deployer,
      controller.address,
      rPropsToken.address,
      rPropsToken.address,
      DAILY_REWARDS_EMISSION
    );

    // Mint some Props tokens beforehand
    await propsToken.connect(deployer).addMinter(deployer.address);
    await propsToken.connect(deployer).mint(deployer.address, PROPS_TOKEN_AMOUNT);

    // Set needed parameters
    await propsToken.connect(deployer).addMinter(rPropsToken.address);
    await rPropsToken.connect(controller).setPropsAppStaking(propsAppStaking.address);
    await rPropsToken.connect(controller).setPropsUserStaking(propsUserStaking.address);
  });

  it("distribute rewards to the app and user Props staking contracts", async () => {
    // Only the controller is permissioned to distribute the rewards
    await expect(
      rPropsToken.connect(alice).distributeRewards(RPROPS_TOKEN_AMOUNT, bn(700000), bn(300000))
    ).to.be.revertedWith("Unauthorized");

    // The distribution percentages must add up to 100%
    await expect(
      rPropsToken.connect(controller).distributeRewards(RPROPS_TOKEN_AMOUNT, bn(700000), bn(400000))
    ).to.be.revertedWith("Invalid percentages");

    // Distribute the rewards
    await rPropsToken
      .connect(controller)
      .distributeRewards(RPROPS_TOKEN_AMOUNT, bn(700000), bn(300000));

    const rPropsForAppRewards = await rPropsToken.balanceOf(propsAppStaking.address);
    const rPropsForUserRewards = await rPropsToken.balanceOf(propsUserStaking.address);

    // Check the rewards were indeed deposited in the staking contracts and the rewards periods began
    expect(rPropsForAppRewards).to.eq(RPROPS_TOKEN_AMOUNT.mul(70).div(100));
    expect(await propsAppStaking.periodFinish()).to.not.eq(bn(0));
    expect(rPropsForUserRewards).to.eq(RPROPS_TOKEN_AMOUNT.sub(rPropsForAppRewards));
    expect(await propsUserStaking.periodFinish()).to.not.eq(bn(0));
  });

  it("multiple reward distributions", async () => {
    // First distribution
    await rPropsToken
      .connect(controller)
      .distributeRewards(RPROPS_TOKEN_AMOUNT, bn(700000), bn(300000));

    // Check the correct amount of rProps got minted
    expect(await rPropsToken.totalSupply()).to.eq(RPROPS_TOKEN_AMOUNT);

    const rPropsForAppRewards1 = await rPropsToken.balanceOf(propsAppStaking.address);
    const rPropsForUserRewards1 = await rPropsToken.balanceOf(propsUserStaking.address);

    // Check the rewards were indeed deposited in the staking contracts
    expect(rPropsForAppRewards1).to.eq(RPROPS_TOKEN_AMOUNT.mul(70).div(100));
    expect(await propsAppStaking.periodFinish()).to.not.eq(bn(0));
    expect(rPropsForUserRewards1).to.eq(RPROPS_TOKEN_AMOUNT.sub(rPropsForAppRewards1));
    expect(await propsUserStaking.periodFinish()).to.not.eq(bn(0));

    // Second distribution
    await rPropsToken
      .connect(controller)
      .distributeRewards(RPROPS_TOKEN_AMOUNT, bn(700000), bn(300000));

    // Check the correct amount of rProps got minted
    expect(await rPropsToken.totalSupply()).to.eq(RPROPS_TOKEN_AMOUNT.mul(2));

    const rPropsForAppRewards2 = await rPropsToken.balanceOf(propsAppStaking.address);
    const rPropsForUserRewards2 = await rPropsToken.balanceOf(propsUserStaking.address);

    // Check the rewards were indeed deposited in the staking contracts
    expect(rPropsForAppRewards2).to.eq(
      rPropsForAppRewards1.add(RPROPS_TOKEN_AMOUNT.mul(70).div(100))
    );
    expect(await propsAppStaking.periodFinish()).to.not.eq(bn(0));
    expect(rPropsForUserRewards2).to.eq(
      rPropsForUserRewards1.add(RPROPS_TOKEN_AMOUNT.sub(rPropsForAppRewards1))
    );
    expect(await propsUserStaking.periodFinish()).to.not.eq(bn(0));
  });

  it("withdraw rewards from the app and user Props staking contracts", async () => {
    // First, distribute the rewards
    await rPropsToken
      .connect(controller)
      .distributeRewards(RPROPS_TOKEN_AMOUNT, bn(700000), bn(300000));

    const appRewardsToWithdraw = RPROPS_TOKEN_AMOUNT.div(2).mul(7).div(10);
    const userRewardsToWithdraw = RPROPS_TOKEN_AMOUNT.div(2).mul(3).div(10);

    // Only the controller is permissioned to withdraw the rewards
    await expect(
      rPropsToken.connect(alice).withdrawRewards(appRewardsToWithdraw, userRewardsToWithdraw)
    ).to.be.revertedWith("Unauthorized");

    // Can only withdraw existing rewards that were not yet distributed
    await expect(
      rPropsToken.connect(controller).withdrawRewards(RPROPS_TOKEN_AMOUNT, RPROPS_TOKEN_AMOUNT)
    ).to.be.revertedWith("Amount exceeds outstanding rewards");

    // Withdraw rewards
    await rPropsToken
      .connect(controller)
      .withdrawRewards(appRewardsToWithdraw, userRewardsToWithdraw);

    // The withdrawn rewards got burned
    expect(await rPropsToken.totalSupply()).to.eq(
      RPROPS_TOKEN_AMOUNT.sub(appRewardsToWithdraw.add(userRewardsToWithdraw))
    );
  });

  it("change the daily reward emission rate on the app and user staking contracts", async () => {
    // Only the controller can change the app daily reward emission rate
    await expect(
      rPropsToken.connect(alice).changeDailyAppRewardEmission(DAILY_REWARDS_EMISSION.add(1))
    ).to.be.revertedWith("Unauthorized");

    const initialAppRewardsDuration = await propsAppStaking.rewardsDuration();
    await rPropsToken
      .connect(controller)
      .changeDailyAppRewardEmission(DAILY_REWARDS_EMISSION.div(2));
    expect((await propsAppStaking.rewardsDuration()).gt(initialAppRewardsDuration)).to.be.true;

    // Only the controller can change the user daily reward emission rate
    await expect(
      rPropsToken.connect(alice).changeDailyUserRewardEmission(DAILY_REWARDS_EMISSION.add(1))
    ).to.be.revertedWith("Unauthorized");

    const initialUserRewardsDuration = await propsUserStaking.rewardsDuration();
    await rPropsToken
      .connect(controller)
      .changeDailyUserRewardEmission(DAILY_REWARDS_EMISSION.div(2));
    expect((await propsUserStaking.rewardsDuration()).gt(initialUserRewardsDuration)).to.be.true;
  });

  it("swap rProps to Props", async () => {
    // First, distribute the rewards in order to get some rProps minted
    await rPropsToken
      .connect(controller)
      .distributeRewards(RPROPS_TOKEN_AMOUNT, bn(700000), bn(300000));

    // Stake
    await propsToken.connect(deployer).transfer(controller.address, expandTo18Decimals(100));
    await propsToken.connect(controller).approve(propsUserStaking.address, expandTo18Decimals(100));
    await propsUserStaking.connect(controller).stake(alice.address, expandTo18Decimals(100));

    // Fast-forward to let some time for the rProps rewards to accrue
    await mineBlock((await now()).add(daysToTimestamp(10)));

    const earned = await propsUserStaking.earned(alice.address);

    // Claim reward and transfer to Alice (initially, it will get owned by the staking contract's owner)
    await propsUserStaking.connect(controller).claimReward(alice.address);
    await rPropsToken.connect(controller).transfer(alice.address, earned);

    // Only the controller can swap rProps for Props
    await expect(rPropsToken.connect(alice).swap(alice.address)).to.be.revertedWith("Unauthorized");

    // Swap Alice's rProps for regular Props
    await rPropsToken.connect(controller).swap(alice.address);

    // Check that the earned reward is now in Alice's Props wallet
    expect(await propsToken.balanceOf(alice.address)).to.eq(earned);
  });

  it("cannot re-set initialization parameters", async () => {
    await expect(
      rPropsToken.connect(controller).setPropsAppStaking(mock.address)
    ).to.be.revertedWith("Already set");
    await expect(
      rPropsToken.connect(controller).setPropsUserStaking(mock.address)
    ).to.be.revertedWith("Already set");
  });
});
