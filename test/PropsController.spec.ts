import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { ethers } from "hardhat";

import type {
  AppToken,
  AppTokenStaking,
  PropsController,
  RPropsToken,
  SPropsAppStaking,
  SPropsUserStaking,
  TestPropsToken
} from "../typechain";
import {
  bn,
  daysToTimestamp,
  deployContract,
  expandTo18Decimals,
  getEvent,
  getFutureAddress
} from "./utils";

chai.use(solidity);
const { expect } = chai;

describe("PropsController", () => {
  let propsTreasury: SignerWithAddress;
  let appTokenOwner: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;

  let propsToken: TestPropsToken;
  let propsController: PropsController;

  const PROPS_TOKEN_AMOUNT = expandTo18Decimals(1000);

  const APP_TOKEN_NAME = "AppToken";
  const APP_TOKEN_SYMBOL = "AppToken";
  const APP_TOKEN_AMOUNT = expandTo18Decimals(1000);

  // Corresponds to 0.0003658 - taken from old Props rewards formula
  // Distributes 12.5% of the remaining rewards pool each year
  const DAILY_REWARDS_EMISSION = bn(3658).mul(1e11);
  const REWARDS_LOCK_DURATION = daysToTimestamp(365);

  const deployAppToken = async (): Promise<[AppToken, AppTokenStaking]> => {
    const tx = await propsController.connect(appTokenOwner)
      .deployAppToken(
        APP_TOKEN_NAME,
        APP_TOKEN_SYMBOL,
        APP_TOKEN_AMOUNT,
        appTokenOwner.address,
        DAILY_REWARDS_EMISSION
      );
    const [appTokenAddress, appTokenStakingAddress, ] = await getEvent(
      await tx.wait(),
      "AppTokenDeployed(address,address,string,uint256)",
      "PropsController"
    );
    
    return [
      (await ethers.getContractFactory("AppToken")).attach(appTokenAddress) as AppToken,
      (await ethers.getContractFactory("AppTokenStaking")).attach(appTokenStakingAddress) as AppTokenStaking
    ];
  }

  beforeEach(async () => {
    [propsTreasury, appTokenOwner, alice, bob, ] = await ethers.getSigners();

    const appTokenLogic = await deployContract<AppToken>("AppToken", propsTreasury);
    const appTokenStakingLogic = await deployContract<AppTokenStaking>("AppTokenStaking", propsTreasury);

    propsToken = await deployContract<TestPropsToken>("TestPropsToken", propsTreasury);
    await propsToken.connect(propsTreasury).initialize(PROPS_TOKEN_AMOUNT);

    const rPropsTokenAddress = getFutureAddress(
      propsTreasury.address,
      (await propsTreasury.getTransactionCount()) + 4
    );

    const propsControllerAddress = getFutureAddress(
      propsTreasury.address,
      (await propsTreasury.getTransactionCount()) + 6
    );

    const sPropsAppStaking = await deployContract<SPropsAppStaking>("SPropsAppStaking", propsTreasury);
    await sPropsAppStaking.connect(propsTreasury)
      .initialize(
        propsControllerAddress,
        rPropsTokenAddress,
        rPropsTokenAddress,
        DAILY_REWARDS_EMISSION
      );

    const sPropsUserStaking = await deployContract<SPropsUserStaking>("SPropsUserStaking", propsTreasury);
    await sPropsUserStaking.connect(propsTreasury)
      .initialize(
        propsControllerAddress,
        rPropsTokenAddress,
        rPropsTokenAddress,
        DAILY_REWARDS_EMISSION,
        REWARDS_LOCK_DURATION
      );

    const rPropsToken = await deployContract<RPropsToken>("RPropsToken", propsTreasury);
    await rPropsToken.connect(propsTreasury)
      .initialize(
        propsToken.address,
        sPropsAppStaking.address,
        bn(800000),
        sPropsUserStaking.address,
        bn(200000)
      );

    propsController = await deployContract<PropsController>("PropsController", propsTreasury);
    await propsController.connect(propsTreasury)
      .initialize(
        propsTreasury.address,
        propsToken.address,
        rPropsToken.address,
        sPropsAppStaking.address,
        sPropsUserStaking.address,
        appTokenLogic.address,
        appTokenStakingLogic.address
      );
  });

  it("successfully deploys a new app token", async () => {
    const [appToken, appTokenStaking] = await deployAppToken();

    // Check that the staking contract was correctly associated with the app token
    expect(await propsController.appTokenToStaking(appToken.address)).to.eq(appTokenStaking.address);

    // Check basic token information
    expect(await appToken.name()).to.eq(APP_TOKEN_NAME);
    expect(await appToken.symbol()).to.eq(APP_TOKEN_SYMBOL);
    expect(await appToken.totalSupply()).to.eq(APP_TOKEN_AMOUNT);

    // Check that the initial supply was properly distributed
    expect(await appToken.balanceOf(propsTreasury.address)).to.eq(APP_TOKEN_AMOUNT.div(20));
    expect(await appToken.balanceOf(appTokenOwner.address)).to.eq(APP_TOKEN_AMOUNT.sub(APP_TOKEN_AMOUNT.div(20)));

    // Check basic staking information
    expect(await appTokenStaking.stakingToken()).to.eq(propsToken.address);
    expect(await appTokenStaking.rewardsToken()).to.eq(appToken.address);
  });

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
    await propsController.connect(alice).stake(
      [appToken1.address, appToken2.address],
      [stakeAmount1, stakeAmount2]
    );

    // Check that the Props were indeed staked in the two app token staking contracts
    expect(await appTokenStaking1.balanceOf(alice.address)).to.eq(stakeAmount1);
    expect(await appTokenStaking2.balanceOf(alice.address)).to.eq(stakeAmount2);

    // Rebalance
    const [adjustment1, adjustment2] = [bn(-80), bn(100)];
    await propsToken.connect(propsTreasury).transfer(alice.address, bn(20));
    await propsToken.connect(alice).approve(propsController.address, bn(20));
    await propsController.connect(alice).stake(
      [appToken1.address, appToken2.address],
      [adjustment1, adjustment2]
    );

    // Check that the staked amounts were properly rebalanced
    expect(await appTokenStaking1.balanceOf(alice.address)).to.eq(bn(20));
    expect(await appTokenStaking2.balanceOf(alice.address)).to.eq(bn(150));
  });

  it("staking adjustment to three apps", async () => {
    const [appToken1, appTokenStaking1] = await deployAppToken();
    const [appToken2, appTokenStaking2] = await deployAppToken();
    const [appToken3, appTokenStaking3] = await deployAppToken();

    // Stake to three apps
    const [stakeAmount1, stakeAmount2, stakeAmount3] = [bn(100), bn(50), bn(80)];
    await propsToken.connect(propsTreasury).transfer(alice.address, bn(230));
    await propsToken.connect(alice).approve(propsController.address, bn(230));
    await propsController.connect(alice).stake(
      [appToken1.address, appToken2.address, appToken3.address],
      [stakeAmount1, stakeAmount2, stakeAmount3]
    );

    // Check that the Props were indeed staked in the two app token staking contracts
    expect(await appTokenStaking1.balanceOf(alice.address)).to.eq(stakeAmount1);
    expect(await appTokenStaking2.balanceOf(alice.address)).to.eq(stakeAmount2);
    expect(await appTokenStaking3.balanceOf(alice.address)).to.eq(stakeAmount3);

    // Rebalance
    const [adjustment1, adjustment2, adjustment3] = [bn(-50), bn(-50), bn(-70)];
    await propsController.connect(alice).stake(
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
    const [appToken, ] = await deployAppToken();

    // No approval to transfer tokens
    await expect(
      propsController.connect(alice).stake([appToken.address], [bn(100)])
    ).to.be.reverted;

    // Stake amount underflow
    await expect(
      propsController.connect(alice).stake([appToken.address], [bn(-100)])
    ).to.be.reverted;
  });

  it("staking adjusts the sProps balance", async () => {
    const [appToken, ] = await deployAppToken();

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
    const [appToken, ] = await deployAppToken();

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
});
