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
  let propsController: SignerWithAddress;
  let propsTreasury: SignerWithAddress;
  let alice: SignerWithAddress;

  let propsToken: TestPropsToken;
  let rPropsToken: RPropsToken;
  let sPropsAppStaking: Staking;
  let sPropsUserStaking: Staking;

  const PROPS_TOKEN_AMOUNT = expandTo18Decimals(100000);

  // Corresponds to 0.0003658 - taken from old Props rewards formula
  // Distributes 12.5% of the remaining rewards pool each year
  const DAILY_REWARDS_EMISSION = bn(3658).mul(1e11);

  beforeEach(async () => {
    [propsController, propsTreasury, alice] = await ethers.getSigners();

    propsToken = await deployContractUpgradeable("TestPropsToken", propsTreasury, [
      PROPS_TOKEN_AMOUNT,
    ]);

    rPropsToken = await deployContractUpgradeable("RPropsToken", propsTreasury, [
      propsController.address,
      propsToken.address,
    ]);

    sPropsAppStaking = await deployContractUpgradeable("Staking", propsTreasury, [
      propsController.address,
      rPropsToken.address,
      rPropsToken.address,
      propsController.address,
      DAILY_REWARDS_EMISSION,
    ]);

    sPropsUserStaking = await deployContractUpgradeable("Staking", propsTreasury, [
      propsController.address,
      rPropsToken.address,
      rPropsToken.address,
      propsController.address,
      DAILY_REWARDS_EMISSION,
    ]);

    // The rProps token contract is allowed to mint new Props
    propsToken.connect(propsTreasury).setMinter(rPropsToken.address);
  });

  it("distribute rewards to the app and user staking contracts", async () => {
    // Only the owner is permissioned to distribute the rewards
    await expect(
      rPropsToken
        .connect(propsTreasury)
        .distributeRewards(
          sPropsAppStaking.address,
          bn(700000),
          sPropsUserStaking.address,
          bn(300000)
        )
    ).to.be.revertedWith("Ownable: caller is not the owner");

    // The distribution percentages must add up to 100%
    await expect(
      rPropsToken
        .connect(propsController)
        .distributeRewards(
          sPropsAppStaking.address,
          bn(700000),
          sPropsUserStaking.address,
          bn(400000)
        )
    ).to.be.revertedWith("Invalid distribution percentages");

    const rPropsToMint = (await propsToken.maxTotalSupply()).sub(await propsToken.totalSupply());

    // Distribute the rewards
    await rPropsToken
      .connect(propsController)
      .distributeRewards(
        sPropsAppStaking.address,
        bn(700000),
        sPropsUserStaking.address,
        bn(300000)
      );

    const rPropsForAppRewards = await rPropsToken.balanceOf(sPropsAppStaking.address);
    const rPropsForUserRewards = await rPropsToken.balanceOf(sPropsUserStaking.address);

    // Check the rewards were indeed deposited in the staking contracts and the rewards periods began
    expect(rPropsForAppRewards).to.eq(rPropsToMint.mul(70).div(100));
    expect(await sPropsAppStaking.periodFinish()).to.not.eq(bn(0));
    expect(rPropsForUserRewards).to.eq(rPropsToMint.sub(rPropsForAppRewards));
    expect(await sPropsUserStaking.periodFinish()).to.not.eq(bn(0));
  });

  it("swap rProps to Props", async () => {
    // First, distribute the rewards in order to get some rProps minted
    await rPropsToken
      .connect(propsController)
      .distributeRewards(
        sPropsAppStaking.address,
        bn(700000),
        sPropsUserStaking.address,
        bn(300000)
      );

    // Stake
    await propsToken.connect(propsTreasury).transfer(propsController.address, bn(100));
    await propsToken.connect(propsController).approve(sPropsUserStaking.address, bn(100));
    await sPropsUserStaking.connect(propsController).stake(alice.address, bn(100));

    // Fast-forward to let some time for the rProps rewards to accrue
    await mineBlock((await now()).add(daysToTimestamp(10)));

    const earned = await sPropsUserStaking.earned(alice.address);

    // Claim reward and transfer to Alice (initially, it will get owned by the staking contract's owner)
    await sPropsUserStaking.connect(propsController).claimReward(alice.address);
    await rPropsToken.connect(propsController).transfer(alice.address, earned);

    // Only the owner can swap rProps for Props
    await expect(rPropsToken.connect(alice).swap(alice.address)).to.be.revertedWith(
      "Ownable: caller is not the owner"
    );

    // Swap Alice's rProps for regular Props
    await rPropsToken.connect(propsController).swap(alice.address);

    // Check that the earned reward is now in Alice's Props wallet
    expect(await propsToken.balanceOf(alice.address)).to.eq(earned);
  });
});
