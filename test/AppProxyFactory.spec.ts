import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { BigNumber } from "ethers";
import { ethers } from "hardhat";

import type {
  AppPoints,
  AppProxyFactory,
  PropsProtocol,
  Staking,
  TestPropsToken,
} from "../typechain";
import {
  bn,
  deployContract,
  deployContractUpgradeable,
  expandTo18Decimals,
  getEvent,
} from "../utils";

chai.use(solidity);
const { expect } = chai;

describe("AppProxyFactory", () => {
  let propsTreasury: SignerWithAddress;
  let appPointsOwner: SignerWithAddress;

  let propsToken: TestPropsToken;
  let appPointsProxyFactory: AppProxyFactory;
  let propsController: PropsProtocol;

  const PROPS_TOKEN_AMOUNT = expandTo18Decimals(100000);

  const APP_POINTS_TOKEN_NAME = "AppPoints";
  const APP_POINTS_TOKEN_SYMBOL = "AppPoints";
  const APP_POINTS_TOKEN_AMOUNT = expandTo18Decimals(100000);

  // Corresponds to 0.0003658 - taken from old Props rewards formula
  // Distributes 12.5% of the remaining rewards pool each year
  const DAILY_REWARDS_EMISSION = bn(3658).mul(1e11);

  const deployApp = async (
    rewardsDistributedPercentage: BigNumber = bn(0)
  ): Promise<[AppPoints, Staking]> => {
    const tx = await appPointsProxyFactory
      .connect(appPointsOwner)
      .deployApp(
        APP_POINTS_TOKEN_NAME,
        APP_POINTS_TOKEN_SYMBOL,
        APP_POINTS_TOKEN_AMOUNT,
        appPointsOwner.address,
        DAILY_REWARDS_EMISSION,
        rewardsDistributedPercentage
      );
    const [appPointsAddress, appPointsStakingAddress] = await getEvent(
      await tx.wait(),
      "AppDeployed(address,address,string,string,address)",
      "AppProxyFactory"
    );

    await propsController.connect(propsTreasury).whitelistApp(appPointsAddress);

    return [
      (await ethers.getContractFactory("AppPoints")).attach(appPointsAddress) as AppPoints,
      (await ethers.getContractFactory("Staking")).attach(appPointsStakingAddress) as Staking,
    ];
  };

  beforeEach(async () => {
    [propsTreasury, appPointsOwner] = await ethers.getSigners();

    propsToken = await deployContractUpgradeable("TestPropsToken", propsTreasury, [
      PROPS_TOKEN_AMOUNT,
    ]);

    propsController = await deployContractUpgradeable("PropsProtocol", propsTreasury, [
      propsTreasury.address,
      propsTreasury.address,
      propsToken.address,
    ]);

    const rPropsToken = await deployContractUpgradeable("RPropsToken", propsTreasury, [
      propsController.address,
      propsToken.address,
    ]);

    const sPropsToken = await deployContractUpgradeable("SPropsToken", propsTreasury, [
      propsController.address,
    ]);

    const sPropsAppStaking = await deployContractUpgradeable("Staking", propsTreasury, [
      propsController.address,
      rPropsToken.address,
      rPropsToken.address,
      propsController.address,
      DAILY_REWARDS_EMISSION,
    ]);

    const sPropsUserStaking = await deployContractUpgradeable("Staking", propsTreasury, [
      propsController.address,
      rPropsToken.address,
      rPropsToken.address,
      propsController.address,
      DAILY_REWARDS_EMISSION,
    ]);

    const appPointsLogic = await deployContract<AppPoints>("AppPoints", propsTreasury);
    const appPointsStakingLogic = await deployContract<Staking>("Staking", propsTreasury);

    appPointsProxyFactory = await deployContractUpgradeable("AppProxyFactory", propsTreasury, [
      propsTreasury.address,
      propsController.address,
      propsTreasury.address,
      propsToken.address,
      appPointsLogic.address,
      appPointsStakingLogic.address,
    ]);

    // The rProps token contract is allowed to mint new Props
    await propsToken.connect(propsTreasury).setMinter(rPropsToken.address);

    // Initialize all needed fields on the controller
    await propsController.connect(propsTreasury).setAppProxyFactory(appPointsProxyFactory.address);
    await propsController.connect(propsTreasury).setRPropsToken(rPropsToken.address);
    await propsController.connect(propsTreasury).setSPropsToken(sPropsToken.address);
    await propsController.connect(propsTreasury).setPropsAppStaking(sPropsAppStaking.address);
    await propsController.connect(propsTreasury).setPropsUserStaking(sPropsUserStaking.address);

    // Distribute the rProps rewards to the sProps staking contracts
    await propsController.connect(propsTreasury).distributePropsRewards(bn(800000), bn(200000));
  });

  it("successfully deploys a new app token", async () => {
    const rewardsDistributedPercentage = bn(10000);
    const [appPoints, appPointsStaking] = await deployApp(rewardsDistributedPercentage);

    // Check that the staking contract was correctly associated with the app token
    expect(await propsController.appPointsStaking(appPoints.address)).to.eq(
      appPointsStaking.address
    );

    // Check basic token information
    expect(await appPoints.name()).to.eq(APP_POINTS_TOKEN_NAME);
    expect(await appPoints.symbol()).to.eq(APP_POINTS_TOKEN_SYMBOL);
    expect(await appPoints.totalSupply()).to.eq(APP_POINTS_TOKEN_AMOUNT);

    // Check that the initial supply was properly distributed (5% goes to the Props treasury)
    expect(await appPoints.balanceOf(propsTreasury.address)).to.eq(APP_POINTS_TOKEN_AMOUNT.div(20));

    const ownerAmount = APP_POINTS_TOKEN_AMOUNT.sub(APP_POINTS_TOKEN_AMOUNT.div(20));
    expect(await appPoints.balanceOf(appPointsOwner.address)).to.eq(
      ownerAmount.sub(ownerAmount.mul(rewardsDistributedPercentage).div(1000000))
    );

    // Check basic staking information
    expect(await appPointsStaking.stakingToken()).to.eq(propsToken.address);
    expect(await appPointsStaking.rewardsToken()).to.eq(appPoints.address);

    // Check the initial rewards were properly distributed on deployment
    expect(await appPointsStaking.rewardRate()).to.not.eq(bn(0));
    expect(await appPoints.balanceOf(appPointsStaking.address)).to.eq(
      ownerAmount.mul(rewardsDistributedPercentage).div(1000000)
    );
  });

  it("proper permissioning", async () => {
    const mockAddress = propsTreasury.address;

    // Only the owner is allowed to change the logic contracts
    await expect(
      appPointsProxyFactory.connect(appPointsOwner).changeAppPointsLogic(mockAddress)
    ).to.be.revertedWith("Unauthorized");
    await expect(
      appPointsProxyFactory.connect(appPointsOwner).changeAppPointsStakingLogic(mockAddress)
    ).to.be.revertedWith("Unauthorized");

    await appPointsProxyFactory.connect(propsTreasury).changeAppPointsLogic(mockAddress);
    await appPointsProxyFactory.connect(propsTreasury).changeAppPointsStakingLogic(mockAddress);
  });
});
