import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { ethers } from "hardhat";

import type {
  AppToken,
  AppTokenStaking,
  PropsController,
  SPropsAppStaking,
  SPropsUserStaking,
  TestPropsToken,
} from "../typechain";
import {
  bn,
  daysToTimestamp,
  deployContract,
  deployContractUpgradeable,
  expandTo18Decimals,
  getEvent,
  mineBlock,
  now,
} from "./utils";

chai.use(solidity);
const { expect } = chai;

describe("PropsController", () => {
  let propsTreasury: SignerWithAddress;
  let appTokenOwner: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;

  let propsToken: TestPropsToken;
  let sPropsAppStaking: SPropsAppStaking;
  let sPropsUserStaking: SPropsUserStaking;
  let propsController: PropsController;

  const PROPS_TOKEN_AMOUNT = expandTo18Decimals(100000);

  const APP_TOKEN_NAME = "AppToken";
  const APP_TOKEN_SYMBOL = "AppToken";
  const APP_TOKEN_AMOUNT = expandTo18Decimals(100000);

  // Corresponds to 0.0003658 - taken from old Props rewards formula
  // Distributes 12.5% of the remaining rewards pool each year
  const DAILY_REWARDS_EMISSION = bn(3658).mul(1e11);

  const deployAppToken = async (): Promise<[AppToken, AppTokenStaking]> => {
    const tx = await propsController
      .connect(appTokenOwner)
      .deployAppToken(
        APP_TOKEN_NAME,
        APP_TOKEN_SYMBOL,
        APP_TOKEN_AMOUNT,
        appTokenOwner.address,
        DAILY_REWARDS_EMISSION
      );
    const [appTokenAddress, appTokenStakingAddress] = await getEvent(
      await tx.wait(),
      "AppTokenDeployed(address,address,string,uint256)",
      "PropsController"
    );

    await propsController.connect(propsTreasury).whitelistAppToken(appTokenAddress);

    return [
      (await ethers.getContractFactory("AppToken")).attach(appTokenAddress) as AppToken,
      (await ethers.getContractFactory("AppTokenStaking")).attach(
        appTokenStakingAddress
      ) as AppTokenStaking,
    ];
  };

  beforeEach(async () => {
    [propsTreasury, appTokenOwner, alice, bob] = await ethers.getSigners();

    const appTokenLogic = await deployContract<AppToken>("AppToken", propsTreasury);
    const appTokenStakingLogic = await deployContract<AppTokenStaking>(
      "AppTokenStaking",
      propsTreasury
    );

    const rPropsTokenAddress = ethers.utils.getContractAddress({
      from: propsTreasury.address,
      nonce: (await propsTreasury.getTransactionCount()) + 3,
    });

    propsToken = await deployContractUpgradeable("TestPropsToken", propsTreasury, [
      PROPS_TOKEN_AMOUNT,
      rPropsTokenAddress,
    ]);

    const propsControllerAddress = ethers.utils.getContractAddress({
      from: propsTreasury.address,
      nonce: (await propsTreasury.getTransactionCount()) + 3,
    });

    sPropsAppStaking = await deployContractUpgradeable("SPropsAppStaking", propsTreasury, [
      propsControllerAddress,
      rPropsTokenAddress,
      rPropsTokenAddress,
      DAILY_REWARDS_EMISSION,
    ]);

    sPropsUserStaking = await deployContractUpgradeable("SPropsUserStaking", propsTreasury, [
      propsControllerAddress,
      rPropsTokenAddress,
      rPropsTokenAddress,
      DAILY_REWARDS_EMISSION,
    ]);

    const rPropsToken = await deployContractUpgradeable("RPropsToken", propsTreasury, [
      propsControllerAddress,
      propsToken.address,
    ]);

    propsController = await deployContractUpgradeable("PropsController", propsTreasury, [
      propsTreasury.address,
      propsTreasury.address,
      propsToken.address,
      rPropsToken.address,
      sPropsAppStaking.address,
      sPropsUserStaking.address,
      appTokenLogic.address,
      appTokenStakingLogic.address,
    ]);

    await propsController.connect(propsTreasury).distributePropsRewards(bn(800000), bn(200000));
  });

  it("successfully deploys a new app token", async () => {
    const [appToken, appTokenStaking] = await deployAppToken();

    // Check that the staking contract was correctly associated with the app token
    expect(await propsController.appTokenToStaking(appToken.address)).to.eq(
      appTokenStaking.address
    );

    // Check basic token information
    expect(await appToken.name()).to.eq(APP_TOKEN_NAME);
    expect(await appToken.symbol()).to.eq(APP_TOKEN_SYMBOL);
    expect(await appToken.totalSupply()).to.eq(APP_TOKEN_AMOUNT);

    // Check that the initial supply was properly distributed (5% goes to Props)
    expect(await appToken.balanceOf(propsTreasury.address)).to.eq(APP_TOKEN_AMOUNT.div(20));
    expect(await appToken.balanceOf(appTokenOwner.address)).to.eq(
      APP_TOKEN_AMOUNT.sub(APP_TOKEN_AMOUNT.div(20))
    );

    // Check basic staking information
    expect(await appTokenStaking.stakingToken()).to.eq(propsToken.address);
    expect(await appTokenStaking.rewardsToken()).to.eq(appToken.address);
  });

  // TODO Add test for off-chain signature staking

  it("basic staking adjustment to a single app", async () => {
    const [appToken, appTokenStaking] = await deployAppToken();

    // Stake
    const stakeAmount = bn(100);
    await propsToken.connect(propsTreasury).transfer(alice.address, stakeAmount);
    await propsToken.connect(alice).approve(propsController.address, stakeAmount);
    await propsController.connect(alice).stake([appToken.address], [stakeAmount]);

    // Check that the Props were indeed staked in the app token staking contract
    expect(await appTokenStaking.balanceOf(alice.address)).to.eq(stakeAmount);

    // Rebalance
    const adjustment = bn(-70);
    await propsController.connect(alice).stake([appToken.address], [adjustment]);

    // Check that the staked amount was properly rebalanced and
    // the remaining Props are back into the staker's wallet
    expect(await appTokenStaking.balanceOf(alice.address)).to.eq(bn(30));
    expect(await propsToken.balanceOf(alice.address)).to.eq(bn(70));
  });

  it("staking adjustment to two apps", async () => {
    const [appToken1, appTokenStaking1] = await deployAppToken();
    const [appToken2, appTokenStaking2] = await deployAppToken();

    // Stake to two apps
    const [stakeAmount1, stakeAmount2] = [bn(100), bn(50)];
    await propsToken.connect(propsTreasury).transfer(alice.address, bn(150));
    await propsToken.connect(alice).approve(propsController.address, bn(150));
    await propsController
      .connect(alice)
      .stake([appToken1.address, appToken2.address], [stakeAmount1, stakeAmount2]);

    // Check that the Props were indeed staked in the two app token staking contracts
    expect(await appTokenStaking1.balanceOf(alice.address)).to.eq(stakeAmount1);
    expect(await appTokenStaking2.balanceOf(alice.address)).to.eq(stakeAmount2);

    // Rebalance
    const [adjustment1, adjustment2] = [bn(-80), bn(100)];
    await propsToken.connect(propsTreasury).transfer(alice.address, bn(20));
    await propsToken.connect(alice).approve(propsController.address, bn(20));
    await propsController
      .connect(alice)
      .stake([appToken1.address, appToken2.address], [adjustment1, adjustment2]);

    // Check that the staked amounts were properly rebalanced
    expect(await appTokenStaking1.balanceOf(alice.address)).to.eq(bn(20));
    expect(await appTokenStaking2.balanceOf(alice.address)).to.eq(bn(150));

    // TODO Check that the total amount staked per app is correct (in all staking adjustment tests)
  });

  it("staking adjustment to three apps", async () => {
    const [appToken1, appTokenStaking1] = await deployAppToken();
    const [appToken2, appTokenStaking2] = await deployAppToken();
    const [appToken3, appTokenStaking3] = await deployAppToken();

    // Stake to three apps
    const [stakeAmount1, stakeAmount2, stakeAmount3] = [bn(100), bn(50), bn(80)];
    await propsToken.connect(propsTreasury).transfer(alice.address, bn(230));
    await propsToken.connect(alice).approve(propsController.address, bn(230));
    await propsController
      .connect(alice)
      .stake(
        [appToken1.address, appToken2.address, appToken3.address],
        [stakeAmount1, stakeAmount2, stakeAmount3]
      );

    // Check that the Props were indeed staked in the two app token staking contracts
    expect(await appTokenStaking1.balanceOf(alice.address)).to.eq(stakeAmount1);
    expect(await appTokenStaking2.balanceOf(alice.address)).to.eq(stakeAmount2);
    expect(await appTokenStaking3.balanceOf(alice.address)).to.eq(stakeAmount3);

    // TODO Add sProps balance checks

    // Rebalance
    const [adjustment1, adjustment2, adjustment3] = [bn(-50), bn(-50), bn(-70)];
    await propsController
      .connect(alice)
      .stake(
        [appToken1.address, appToken2.address, appToken3.address],
        [adjustment1, adjustment2, adjustment3]
      );

    // Check that the staked amounts were properly rebalanced and
    // the remaining Props are back into the staker's wallet
    expect(await appTokenStaking1.balanceOf(alice.address)).to.eq(bn(50));
    expect(await appTokenStaking2.balanceOf(alice.address)).to.eq(bn(0));
    expect(await appTokenStaking3.balanceOf(alice.address)).to.eq(bn(10));
    expect(await propsToken.balanceOf(alice.address)).to.eq(bn(170));
  });

  it("properly handles an invalid staking adjustment", async () => {
    const [appToken] = await deployAppToken();

    // No approval to transfer tokens
    await expect(propsController.connect(alice).stake([appToken.address], [bn(100)])).to.be
      .reverted;

    // Stake amount underflow
    await expect(propsController.connect(alice).stake([appToken.address], [bn(-100)])).to.be
      .reverted;

    // TODO Be explicit about the revert message
  });

  it("staking adjusts the sProps balance", async () => {
    const [appToken] = await deployAppToken();

    // Stake
    const stakeAmount = bn(100);
    await propsToken.connect(propsTreasury).transfer(alice.address, stakeAmount);
    await propsToken.connect(alice).approve(propsController.address, stakeAmount);
    await propsController.connect(alice).stake([appToken.address], [stakeAmount]);

    expect(await propsController.balanceOf(alice.address)).to.eq(stakeAmount);

    // Rebalance
    const adjustment = bn(-70);
    await propsController.connect(alice).stake([appToken.address], [adjustment]);

    expect(await propsController.balanceOf(alice.address)).to.eq(bn(30));
  });

  it("sProps are not transferrable", async () => {
    const [appToken] = await deployAppToken();

    // Stake
    const stakeAmount = bn(100);
    await propsToken.connect(propsTreasury).transfer(alice.address, stakeAmount);
    await propsToken.connect(alice).approve(propsController.address, stakeAmount);
    await propsController.connect(alice).stake([appToken.address], [stakeAmount]);

    // Try transferring
    await expect(
      propsController.connect(alice).transfer(bob.address, stakeAmount)
    ).to.be.revertedWith("sProps are not transferrable");

    // Try approving
    await expect(
      propsController.connect(alice).approve(bob.address, stakeAmount)
    ).to.be.revertedWith("sProps are not transferrable");
  });

  it("claim app token rewards", async () => {
    const [appToken, appTokenStaking] = await deployAppToken();

    // Distribute app token rewards
    const rewardAmount = expandTo18Decimals(10000);
    await appToken.connect(appTokenOwner).transfer(appTokenStaking.address, rewardAmount);
    await appTokenStaking.connect(appTokenOwner).notifyRewardAmount(rewardAmount);

    // Stake
    const stakeAmount = bn(100);
    await propsToken.connect(propsTreasury).transfer(alice.address, stakeAmount);
    await propsToken.connect(alice).approve(propsController.address, stakeAmount);
    await propsController.connect(alice).stake([appToken.address], [stakeAmount]);

    // Fast-forward a few days
    await mineBlock((await now()).add(daysToTimestamp(10)));

    const earned = await appTokenStaking.earned(alice.address);

    // Claim app token rewards
    await propsController.connect(alice).claimAppTokenRewards(appToken.address);

    // Ensure results are within .01%
    const inWallet = await appToken.balanceOf(alice.address);
    expect(earned.sub(inWallet).abs().lte(inWallet.div(10000))).to.be.true;
  });

  it("claim app Props rewards", async () => {
    const [appToken] = await deployAppToken();

    // Stake
    const stakeAmount = bn(100);
    await propsToken.connect(propsTreasury).transfer(alice.address, stakeAmount);
    await propsToken.connect(alice).approve(propsController.address, stakeAmount);
    await propsController.connect(alice).stake([appToken.address], [stakeAmount]);

    // Fast-forward a few days
    await mineBlock((await now()).add(daysToTimestamp(10)));

    // Only the app token's owner can claim app Props rewards
    await expect(
      propsController.connect(alice).claimAppPropsRewards(appToken.address)
    ).to.be.revertedWith("Only app token owner can claim rewards");

    const earned = await sPropsAppStaking.earned(appToken.address);

    // Claim app Props rewards
    await propsController.connect(appTokenOwner).claimAppPropsRewards(appToken.address);

    // Ensure results are within .01%
    const inWallet = await propsToken.balanceOf(appTokenOwner.address);
    expect(earned.sub(inWallet).abs().lte(inWallet.div(10000))).to.be.true;
  });

  it("claim user Props rewards", async () => {
    const [appToken] = await deployAppToken();

    // Stake
    const stakeAmount = bn(100);
    await propsToken.connect(propsTreasury).transfer(alice.address, stakeAmount);
    await propsToken.connect(alice).approve(propsController.address, stakeAmount);
    await propsController.connect(alice).stake([appToken.address], [stakeAmount]);

    // Fast-forward a few days
    await mineBlock((await now()).add(daysToTimestamp(10)));

    const earned = await sPropsUserStaking.earned(alice.address);

    // Claim user Props rewards
    await propsController.connect(alice).claimUserPropsRewards();

    // Make sure the user Props rewards weren't directly transferred to their wallet
    expect(await propsToken.balanceOf(alice.address)).to.eq(bn(0));

    // Ensure results are within .01%
    const inEscrow = await propsController.rewardsEscrow(alice.address);
    expect(earned.sub(inEscrow).abs().lte(inEscrow.div(10000))).to.be.true;
  });

  it("basic rewards staking adjustment to a single app", async () => {
    const [appToken, appTokenStaking] = await deployAppToken();

    // Stake
    const principalStakeAmount = bn(100);
    await propsToken.connect(propsTreasury).transfer(alice.address, principalStakeAmount);
    await propsToken.connect(alice).approve(propsController.address, principalStakeAmount);
    await propsController.connect(alice).stake([appToken.address], [principalStakeAmount]);

    // Fast-forward a few days
    await mineBlock((await now()).add(daysToTimestamp(10)));

    // Claim user Props rewards
    await propsController.connect(alice).claimUserPropsRewards();

    const escrowedRewards = await propsController.rewardsEscrow(alice.address);
    const rewardsStakeAmount = escrowedRewards.div(2);

    // Stake the escrowed rewards
    await propsController.connect(alice).stakeRewards([appToken.address], [rewardsStakeAmount]);

    expect(await appTokenStaking.balanceOf(alice.address)).to.eq(
      principalStakeAmount.add(rewardsStakeAmount)
    );
    expect(await sPropsAppStaking.balanceOf(appToken.address)).to.eq(
      principalStakeAmount.add(rewardsStakeAmount)
    );
    expect(await sPropsUserStaking.balanceOf(alice.address)).to.eq(
      principalStakeAmount.add(rewardsStakeAmount)
    );

    // Rebalance
    await propsController
      .connect(alice)
      .stakeRewards([appToken.address], [rewardsStakeAmount.mul(-1)]);

    expect(await appTokenStaking.balanceOf(alice.address)).to.eq(principalStakeAmount);
    expect(await sPropsAppStaking.balanceOf(appToken.address)).to.eq(principalStakeAmount);
    expect(await sPropsUserStaking.balanceOf(alice.address)).to.eq(principalStakeAmount);
  });

  // TODO stakeWithPermit, claimRewards, staked and withdrawn events from the StakingManager
});
