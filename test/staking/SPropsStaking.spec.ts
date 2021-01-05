import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { ethers } from "hardhat";

import type { RPropsToken, SPropsStaking, TestPropsToken } from "../../typechain";
import { bn, deployContractUpgradeable, expandTo18Decimals } from "../utils";

chai.use(solidity);
const { expect } = chai;

describe("SPropsStaking", () => {
  let propsController: SignerWithAddress;
  let rewardsDistribution: SignerWithAddress;
  let alice: SignerWithAddress;

  let propsToken: TestPropsToken;
  let rPropsToken: RPropsToken;
  let sPropsStaking: SPropsStaking;

  const PROPS_TOKEN_AMOUNT = expandTo18Decimals(900000000);

  // Corresponds to 0.0003658 - taken from old Props rewards formula
  // Distributes 12.5% of the remaining rewards pool each year
  const DAILY_REWARDS_EMISSION = bn(3658).mul(1e11);

  beforeEach(async () => {
    [propsController, rewardsDistribution, alice] = await ethers.getSigners();

    propsToken = await deployContractUpgradeable("TestPropsToken", propsController, [
      PROPS_TOKEN_AMOUNT,
    ]);

    rPropsToken = await deployContractUpgradeable("RPropsToken", propsController, [
      propsController.address,
      propsToken.address,
    ]);

    sPropsStaking = await deployContractUpgradeable("SPropsStaking", propsController, [
      propsController.address,
      rewardsDistribution.address,
      rPropsToken.address,
      propsToken.address,
      DAILY_REWARDS_EMISSION,
    ]);
  });

  it("stakes and withdrawns are implicit (no tokens are transferred to/from the staking contract)", async () => {
    const stakeAmount = bn(100000);

    // Stake
    await sPropsStaking.connect(propsController).stake(alice.address, stakeAmount);
    expect(await sPropsStaking.balanceOf(alice.address)).to.eq(stakeAmount);

    // Withdraw
    await sPropsStaking.connect(propsController).withdraw(alice.address, stakeAmount);
    expect(await sPropsStaking.balanceOf(alice.address)).to.eq(bn(0));
  });

  it("properly handles invalid withdraw amounts", async () => {
    await expect(
      sPropsStaking.connect(propsController).withdraw(alice.address, bn(100))
    ).to.be.revertedWith("SafeMath: subtraction overflow");
  });
});
