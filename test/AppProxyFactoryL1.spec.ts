import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { ethers } from "hardhat";

import type { AppPointsL1, AppProxyFactoryL1, MockAppProxyFactoryBridgeL1 } from "../typechain";
import {
  bn,
  deployContract,
  deployContractUpgradeable,
  expandTo18Decimals,
  getEvents,
} from "../utils";

chai.use(solidity);
const { expect } = chai;

describe("AppProxyFactoryL1", () => {
  let deployer: SignerWithAddress;
  let controller: SignerWithAddress;
  let treasury: SignerWithAddress;
  let appOwner: SignerWithAddress;
  let mock: SignerWithAddress;

  let appProxyFactoryBridge: MockAppProxyFactoryBridgeL1;
  let appProxyFactory: AppProxyFactoryL1;

  const APP_POINTS_TOKEN_NAME = "AppPoints";
  const APP_POINTS_TOKEN_SYMBOL = "AppPoints";
  const APP_POINTS_TOKEN_AMOUNT = expandTo18Decimals(10000);
  // Corresponds to 0.0003658 - taken from old Props rewards formula
  // Distributes 12.5% of the remaining rewards pool each year
  const DAILY_REWARDS_EMISSION = bn(3658).mul(1e11);

  const deployApp = async (): Promise<AppPointsL1> => {
    const tx = await appProxyFactory
      .connect(appOwner)
      .deployApp(
        APP_POINTS_TOKEN_NAME,
        APP_POINTS_TOKEN_SYMBOL,
        APP_POINTS_TOKEN_AMOUNT,
        appOwner.address,
        DAILY_REWARDS_EMISSION
      );
    const [[appPointsAddress]] = await getEvents(
      await tx.wait(),
      "AppDeployed(address,string,string,address)",
      "AppProxyFactoryL1"
    );

    return (await ethers.getContractFactory("AppPointsL1")).attach(appPointsAddress) as AppPointsL1;
  };

  beforeEach(async () => {
    [deployer, controller, treasury, appOwner, mock] = await ethers.getSigners();

    const appPointsLogic = await deployContract("AppPointsL1", deployer);

    appProxyFactory = await deployContractUpgradeable(
      "AppProxyFactoryL1",
      deployer,
      controller.address,
      treasury.address,
      appPointsLogic.address
    );

    appProxyFactoryBridge = await deployContract(
      "MockAppProxyFactoryBridgeL1",
      deployer,
      appProxyFactory.address
    );

    // Set needed parameters
    await appProxyFactory
      .connect(controller)
      .changeAppProxyFactoryBridge(appProxyFactoryBridge.address);
  });

  it("successfully deploys a new app token", async () => {
    const appPoints = await deployApp();

    // Check basic token information
    expect(await appPoints.name()).to.eq(APP_POINTS_TOKEN_NAME);
    expect(await appPoints.symbol()).to.eq(APP_POINTS_TOKEN_SYMBOL);
    expect(await appPoints.totalSupply()).to.eq(APP_POINTS_TOKEN_AMOUNT);

    // Check that the initial supply was properly distributed (5% of it goes to the Props treasury)
    const treasuryBalance = await appPoints.balanceOf(treasury.address);
    expect(treasuryBalance).to.eq(APP_POINTS_TOKEN_AMOUNT.mul(5).div(100));
    expect(await appPoints.balanceOf(appOwner.address)).to.eq(
      APP_POINTS_TOKEN_AMOUNT.sub(treasuryBalance)
    );
  });

  it("change AppPoints logic contract", async () => {
    // Change the logic contract for AppPoints
    const newAppPointsLogic = await deployContract("AppPointsL1", deployer);
    await appProxyFactory.connect(controller).changeAppPointsLogic(newAppPointsLogic.address);
    expect(await appProxyFactory.appPointsLogic()).to.eq(newAppPointsLogic.address);

    const appPoints = await deployApp();

    // Check the deployment with the new logic contract is correct
    expect(await appPoints.name()).to.eq(APP_POINTS_TOKEN_NAME);
    expect(await appPoints.symbol()).to.eq(APP_POINTS_TOKEN_SYMBOL);
    expect(await appPoints.totalSupply()).to.eq(APP_POINTS_TOKEN_AMOUNT);
  });

  it("proper permissioning", async () => {
    // Only the controller can change the logic contracts
    await expect(
      appProxyFactory.connect(mock).changeAppPointsLogic(mock.address)
    ).to.be.revertedWith("Unauthorized");
    await appProxyFactory.connect(controller).changeAppPointsLogic(mock.address);
    expect(await appProxyFactory.appPointsLogic()).to.eq(mock.address);

    // Only the controller can change the bridge address
    await expect(
      appProxyFactory.connect(mock).changeAppProxyFactoryBridge(mock.address)
    ).to.be.revertedWith("Unauthorized");
    await appProxyFactory.connect(controller).changeAppProxyFactoryBridge(mock.address);
    expect(await appProxyFactory.appProxyFactoryBridge()).to.eq(mock.address);

    // Transfer control
    await appProxyFactory.connect(controller).transferControl(mock.address);
    expect(await appProxyFactory.controller()).to.eq(mock.address);

    // Check the control was properly transferred
    await expect(
      appProxyFactory.connect(controller).changeAppPointsLogic(mock.address)
    ).to.be.revertedWith("Unauthorized");
    await appProxyFactory.connect(mock).changeAppPointsLogic(mock.address);
  });
});
