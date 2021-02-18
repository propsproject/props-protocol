import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { ethers } from "hardhat";

import type { RPropsToken, Staking, TestPropsToken } from "../../typechain";
import {
  bn,
  daysToTimestamp,
  deployContractUpgradeable,
  expandTo18Decimals,
  mineBlock,
  now,
} from "../../utils";

chai.use(solidity);
const { expect } = chai;

describe("RPropsToken", () => {
  let deployer: SignerWithAddress;
  let controller: SignerWithAddress;
  let alice: SignerWithAddress;

  let propsToken: TestPropsToken;
  let rPropsToken: RPropsToken;
  let propsAppStaking: Staking;
  let propsUserStaking: Staking;

  const PROPS_TOKEN_AMOUNT = expandTo18Decimals(100000);
  // Corresponds to 0.0003658 - taken from old Props rewards formula
  // Distributes 12.5% of the remaining rewards pool each year
  const DAILY_REWARDS_EMISSION = bn(3658).mul(1e11);

  beforeEach(async () => {
    [deployer, controller, alice] = await ethers.getSigners();

    propsToken = await deployContractUpgradeable("TestPropsToken", deployer, PROPS_TOKEN_AMOUNT);

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

    // Set needed parameters
    propsToken.connect(deployer).addMinter(rPropsToken.address);
  });

  it("distribute rewards to the app and user Props staking contracts", async () => {
    // Only the owner is permissioned to distribute the rewards
    await expect(
      rPropsToken
        .connect(alice)
        .distributeRewards(
          propsAppStaking.address,
          bn(700000),
          propsUserStaking.address,
          bn(300000)
        )
    ).to.be.revertedWith("Unauthorized");

    // The distribution percentages must add up to 100%
    await expect(
      rPropsToken
        .connect(controller)
        .distributeRewards(
          propsAppStaking.address,
          bn(700000),
          propsUserStaking.address,
          bn(400000)
        )
    ).to.be.revertedWith("Invalid percentages");

    const rPropsToMint = (await propsToken.maxTotalSupply()).sub(await propsToken.totalSupply());

    // Distribute the rewards
    await rPropsToken
      .connect(controller)
      .distributeRewards(propsAppStaking.address, bn(700000), propsUserStaking.address, bn(300000));

    const rPropsForAppRewards = await rPropsToken.balanceOf(propsAppStaking.address);
    const rPropsForUserRewards = await rPropsToken.balanceOf(propsUserStaking.address);

    // Check the rewards were indeed deposited in the staking contracts and the rewards periods began
    expect(rPropsForAppRewards).to.eq(rPropsToMint.mul(70).div(100));
    expect(await propsAppStaking.periodFinish()).to.not.eq(bn(0));
    expect(rPropsForUserRewards).to.eq(rPropsToMint.sub(rPropsForAppRewards));
    expect(await propsUserStaking.periodFinish()).to.not.eq(bn(0));
  });

  it("swap rProps to Props", async () => {
    // First, distribute the rewards in order to get some rProps minted
    await rPropsToken
      .connect(controller)
      .distributeRewards(propsAppStaking.address, bn(700000), propsUserStaking.address, bn(300000));

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

    // Only the owner can swap rProps for Props
    await expect(rPropsToken.connect(alice).swap(alice.address)).to.be.revertedWith("Unauthorized");

    // Swap Alice's rProps for regular Props
    await rPropsToken.connect(controller).swap(alice.address);

    // Check that the earned reward is now in Alice's Props wallet
    expect(await propsToken.balanceOf(alice.address)).to.eq(earned);
  });
});
