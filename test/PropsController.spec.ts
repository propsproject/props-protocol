import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { ethers } from "hardhat";

import type {
  AppToken,
  PropsController,
  AppTokenStaking,
  TestErc20,
  SPropsUserToken,
  SPropsAppToken
} from "../typechain";
import {
  bn,
  deployContract,
  expandTo18Decimals,
  getEvent
} from "./utils";

chai.use(solidity);
const { expect } = chai;

describe("PropsController", () => {
  let propsTreasury: SignerWithAddress;
  let appTokenOwner: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;

  let propsToken: TestErc20;
  let propsController: PropsController;

  const PROPS_TOKEN_NAME = "Props";
  const PROPS_TOKEN_SYMBOL = "Props";
  const PROPS_TOKEN_AMOUNT = expandTo18Decimals(1000);

  const APP_TOKEN_NAME = "AppToken";
  const APP_TOKEN_SYMBOL = "AppToken";
  const APP_TOKEN_AMOUNT = expandTo18Decimals(1000);

  // Corresponds to 0.0003658 - taken from old Props rewards formula
  // Distributes 12.5% of the remaining rewards pool each year
  const DAILY_REWARDS_EMISSION = bn(3658).mul(1e11);

  const deployAppToken = async (): Promise<[AppToken, AppTokenStaking]> => {
    const tx = await propsController.connect(appTokenOwner)
      .deployAppToken(
        APP_TOKEN_NAME,
        APP_TOKEN_SYMBOL,
        APP_TOKEN_AMOUNT,
        appTokenOwner.address,
        propsTreasury.address,
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

    propsToken = await deployContract<TestErc20>(
      "TestERC20",
      propsTreasury,
      PROPS_TOKEN_NAME,
      PROPS_TOKEN_SYMBOL,
      PROPS_TOKEN_AMOUNT
    );

    propsController = await deployContract<PropsController>("PropsController", propsTreasury);
    await propsController.connect(propsTreasury)
      .initialize(
        propsToken.address,
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

  it("staking adjusts sProps balances", async () => {
    const [appToken, ] = await deployAppToken();

    const sPropsAppToken =
    (await ethers.getContractFactory("SPropsAppToken"))
      .attach(await propsController.sPropsAppToken()) as SPropsAppToken;
    const sPropsUserToken =
      (await ethers.getContractFactory("SPropsUserToken"))
        .attach(await propsController.sPropsUserToken()) as SPropsUserToken;

    // Stake
    const stakeAmount = bn(100);
    await propsToken.connect(propsTreasury).transfer(alice.address, stakeAmount);
    await propsToken.connect(alice).approve(propsController.address, stakeAmount);
    await propsController.connect(alice).stake([appToken.address], [stakeAmount]);

    expect(await sPropsAppToken.balanceOf(appToken.address)).to.eq(stakeAmount);
    expect(await sPropsUserToken.balanceOf(alice.address)).to.eq(stakeAmount);

    // Rebalance
    const adjustment = bn(-70);
    await propsController.connect(alice).stake([appToken.address], [adjustment]);

    expect(await sPropsAppToken.balanceOf(appToken.address)).to.eq(bn(30));
    expect(await sPropsUserToken.balanceOf(alice.address)).to.eq(bn(30));
  });
});
