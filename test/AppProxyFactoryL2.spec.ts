import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { ethers } from "hardhat";

import type {
  AppPointsL2,
  AppProxyFactoryL2,
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

describe("AppProxyFactoryL2", () => {
  let deployer: SignerWithAddress;
  let controller: SignerWithAddress;
  let treasury: SignerWithAddress;
  let guardian: SignerWithAddress;
  let appOwner: SignerWithAddress;
  let appProxyFactoryBridge: SignerWithAddress;
  let mock: SignerWithAddress;

  let propsToken: TestPropsToken;
  let appProxyFactory: AppProxyFactoryL2;
  let propsProtocol: PropsProtocol;

  const PROPS_TOKEN_AMOUNT = expandTo18Decimals(100000);
  const APP_POINTS_TOKEN_NAME = "AppPoints";
  const APP_POINTS_TOKEN_SYMBOL = "AppPoints";
  // Corresponds to 0.0003658 - taken from old Props rewards formula
  // Distributes 12.5% of the remaining rewards pool each year
  const DAILY_REWARDS_EMISSION = bn(3658).mul(1e11);

  const deployApp = async (): Promise<[AppPointsL2, Staking]> => {
    const tx = await appProxyFactory
      .connect(appProxyFactoryBridge)
      .deployApp(
        "0x0000000000000000000000000000000000000000",
        APP_POINTS_TOKEN_NAME,
        APP_POINTS_TOKEN_SYMBOL,
        appOwner.address,
        DAILY_REWARDS_EMISSION
      );
    const [, appPointsAddress, appPointsStakingAddress] = await getEvent(
      await tx.wait(),
      "AppDeployed(address,address,address,string,string,address)",
      "AppProxyFactoryL2"
    );

    await propsProtocol.connect(controller).whitelistApp(appPointsAddress);

    return [
      (await ethers.getContractFactory("AppPointsL2")).attach(appPointsAddress) as AppPointsL2,
      (await ethers.getContractFactory("Staking")).attach(appPointsStakingAddress) as Staking,
    ];
  };

  beforeEach(async () => {
    [
      deployer,
      controller,
      treasury,
      guardian,
      appOwner,
      appProxyFactoryBridge,
      mock,
    ] = await ethers.getSigners();

    propsToken = await deployContractUpgradeable("TestPropsToken", deployer, PROPS_TOKEN_AMOUNT);

    propsProtocol = await deployContractUpgradeable(
      "PropsProtocol",
      deployer,
      controller.address,
      guardian.address,
      propsToken.address
    );

    const appPointsLogic = await deployContract("AppPointsL2", deployer);
    const appPointsStakingLogic = await deployContract("Staking", deployer);

    appProxyFactory = await deployContractUpgradeable(
      "AppProxyFactoryL2",
      deployer,
      controller.address,
      propsProtocol.address,
      treasury.address,
      propsToken.address,
      appPointsLogic.address,
      appPointsStakingLogic.address
    );

    // Set needed parameters
    await appProxyFactory
      .connect(controller)
      .setAppProxyFactoryBridge(appProxyFactoryBridge.address);
    await propsProtocol.connect(controller).setAppProxyFactory(appProxyFactory.address);
  });

  it("successfully deploys a new app token", async () => {
    const [appPoints, appPointsStaking] = await deployApp();

    // Check that the staking contract was correctly associated with the app token
    expect(await propsProtocol.appPointsStaking(appPoints.address)).to.eq(appPointsStaking.address);

    // Check basic token information
    expect(await appPoints.name()).to.eq(APP_POINTS_TOKEN_NAME);
    expect(await appPoints.symbol()).to.eq(APP_POINTS_TOKEN_SYMBOL);
    expect(await appPoints.totalSupply()).to.eq(bn(0));

    // Check basic staking information
    expect(await appPointsStaking.rewardsToken()).to.eq(appPoints.address);
  });

  it("proper permissioning", async () => {
    // A random address cannot change the logic contracts
    await expect(
      appProxyFactory.connect(mock).changeAppPointsLogic(mock.address)
    ).to.be.revertedWith("Unauthorized");
    await expect(
      appProxyFactory.connect(mock).changeAppPointsStakingLogic(mock.address)
    ).to.be.revertedWith("Unauthorized");

    // Only the controller can change the logic contracts
    await appProxyFactory.connect(controller).changeAppPointsLogic(mock.address);
    await appProxyFactory.connect(controller).changeAppPointsStakingLogic(mock.address);
  });
});
