import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import * as fs from "fs";
import { ethers } from "hardhat";

import type {
  AppToken,
  AppTokenProxyFactory,
  PropsController,
  RPropsToken,
  SPropsToken,
  Staking,
  TestPropsToken,
} from "../typechain";
import { bn, deployContract, deployContractUpgradeable, expandTo18Decimals } from "../utils";

// Constants
const PROPS_TOKEN_AMOUNT = expandTo18Decimals(900000000);
const DAILY_REWARDS_EMISSION = bn(3658).mul(1e11);

// Accounts
let deployer: SignerWithAddress;
let propsControllerOwner: SignerWithAddress;
let propsTreasury: SignerWithAddress;
let propsGuardian: SignerWithAddress;

// Contracts
let propsToken: TestPropsToken;
let propsController: PropsController;
let sPropsToken: SPropsToken;
let rPropsToken: RPropsToken;
let sPropsAppStaking: Staking;
let sPropsUserStaking: Staking;
let appTokenLogic: AppToken;
let appTokenStakingLogic: Staking;
let appTokenProxyFactory: AppTokenProxyFactory;

async function main() {
  [deployer, propsControllerOwner, propsTreasury, propsGuardian] = await ethers.getSigners();

  console.log("Using the following addresses:");
  console.log(`Deployer: ${deployer.address}`);
  console.log(`PropsController owner: ${propsControllerOwner.address}`);
  console.log(`Props treasury: ${propsTreasury.address}`);
  console.log(`Props guardian: ${propsGuardian.address}`);

  const network = (await ethers.provider.getNetwork()).name;

  console.log(`Detected network: ${network}`);

  if (fs.existsSync(`${network}.json`)) {
    console.log(`Contracts file found, connecting to deployed instances...`);

    // Connect to deployed contracts
    const contractAddresses = JSON.parse(fs.readFileSync(`${network}.json`).toString());

    propsToken = (await ethers.getContractFactory("TestPropsToken", deployer)).attach(
      contractAddresses.propsToken
    ) as TestPropsToken;

    propsController = (await ethers.getContractFactory("PropsController", deployer)).attach(
      contractAddresses.propsController
    ) as PropsController;

    rPropsToken = (await ethers.getContractFactory("RPropsToken")).attach(
      contractAddresses.rPropsToken
    ) as RPropsToken;

    sPropsToken = (await ethers.getContractFactory("SPropsToken")).attach(
      contractAddresses.sPropsToken
    ) as SPropsToken;

    sPropsAppStaking = (await ethers.getContractFactory("Staking")).attach(
      contractAddresses.sPropsAppStaking
    ) as Staking;

    sPropsUserStaking = (await ethers.getContractFactory("Staking")).attach(
      contractAddresses.sPropsUserStaking
    ) as Staking;

    appTokenLogic = (await ethers.getContractFactory("AppToken")).attach(
      contractAddresses.appTokenLogic
    ) as AppToken;

    appTokenStakingLogic = (await ethers.getContractFactory("Staking")).attach(
      contractAddresses.appTokenStakingLogic
    ) as Staking;

    appTokenProxyFactory = (await ethers.getContractFactory("AppTokenProxyFactory")).attach(
      contractAddresses.appTokenProxyFactory
    ) as AppTokenProxyFactory;

    console.log("Connected successfully!");
  } else {
    console.log("Contracts file not found, deploying new contract instances...");

    // Deploy new contracts
    const contractAddresses: any = {};

    propsToken = await deployContractUpgradeable("TestPropsToken", deployer, [PROPS_TOKEN_AMOUNT]);
    await propsToken.deployed();
    contractAddresses.propsToken = propsToken.address;

    propsController = await deployContractUpgradeable("PropsController", deployer, [
      propsControllerOwner.address,
      propsGuardian.address,
      propsToken.address,
    ]);
    await propsController.deployed();
    contractAddresses.propsController = propsController.address;

    rPropsToken = await deployContractUpgradeable("RPropsToken", deployer, [
      propsController.address,
      propsToken.address,
    ]);
    await rPropsToken.deployed();
    contractAddresses.rPropsToken = rPropsToken.address;

    sPropsToken = await deployContractUpgradeable("SPropsToken", deployer, [
      propsController.address,
    ]);
    await sPropsToken.deployed();
    contractAddresses.sPropsToken = sPropsToken.address;

    sPropsAppStaking = await deployContractUpgradeable("Staking", deployer, [
      propsController.address,
      rPropsToken.address,
      rPropsToken.address,
      propsController.address,
      DAILY_REWARDS_EMISSION,
    ]);
    await sPropsAppStaking.deployed();
    contractAddresses.sPropsAppStaking = sPropsAppStaking.address;

    sPropsUserStaking = await deployContractUpgradeable("Staking", deployer, [
      propsController.address,
      rPropsToken.address,
      rPropsToken.address,
      propsController.address,
      DAILY_REWARDS_EMISSION,
    ]);
    await sPropsUserStaking.deployed();
    contractAddresses.sPropsUserStaking = sPropsUserStaking.address;

    appTokenLogic = await deployContract("AppToken", deployer);
    await appTokenLogic.deployed();
    contractAddresses.appTokenLogic = appTokenLogic.address;

    appTokenStakingLogic = await deployContract("Staking", deployer);
    await appTokenStakingLogic.deployed();
    contractAddresses.appTokenStakingLogic = appTokenStakingLogic.address;

    appTokenProxyFactory = await deployContractUpgradeable("AppTokenProxyFactory", deployer, [
      propsControllerOwner.address,
      propsController.address,
      propsTreasury.address,
      propsToken.address,
      appTokenLogic.address,
      appTokenStakingLogic.address,
    ]);
    await appTokenProxyFactory.deployed();
    contractAddresses.appTokenProxyFactory = appTokenProxyFactory.address;

    console.log("Deployment successfully done!");

    console.log("Initializing contracts state...");

    // The rProps token contract is allowed to mint new Props
    await propsToken.connect(deployer).setMinter(rPropsToken.address, { gasLimit: 1000000 });

    // Initialize all needed fields on the controller
    await propsController
      .connect(propsControllerOwner)
      .setAppTokenProxyFactory(appTokenProxyFactory.address, { gasLimit: 1000000 });
    await propsController
      .connect(propsControllerOwner)
      .setRPropsToken(rPropsToken.address, { gasLimit: 1000000 });
    await propsController
      .connect(propsControllerOwner)
      .setSPropsToken(sPropsToken.address, { gasLimit: 1000000 });
    await propsController
      .connect(propsControllerOwner)
      .setSPropsAppStaking(sPropsAppStaking.address, { gasLimit: 1000000 });
    await propsController
      .connect(propsControllerOwner)
      .setSPropsUserStaking(sPropsUserStaking.address, { gasLimit: 1000000 });

    console.log("Contracts successfully initialized!");

    fs.writeFileSync(`${network}.json`, JSON.stringify(contractAddresses, null, 2));
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.log(error);
    process.exit(1);
  });
