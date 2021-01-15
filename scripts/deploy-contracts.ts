import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import * as fs from "fs";
import { ethers } from "hardhat";

import type {
  AppToken,
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
let appTokenLogic: AppToken;
let appTokenStakingLogic: Staking;
let propsController: PropsController;
let sPropsToken: SPropsToken;
let rPropsToken: RPropsToken;
let sPropsAppStaking: Staking;
let sPropsUserStaking: Staking;

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

    propsToken = (await ethers.getContractFactory("TestPropsToken")).attach(
      contractAddresses.propsToken
    ) as TestPropsToken;

    appTokenLogic = (await ethers.getContractFactory("AppToken")).attach(
      contractAddresses.appTokenLogic
    ) as AppToken;

    appTokenStakingLogic = (await ethers.getContractFactory("Staking")).attach(
      contractAddresses.appTokenStakingLogic
    ) as Staking;

    propsController = (await ethers.getContractFactory("PropsController")).attach(
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

    console.log("Connected successfully!");
  } else {
    console.log("Contracts file not found, deploying new contract instances...");

    // Deploy new contracts
    const contractAddresses: any = {};

    propsToken = await deployContractUpgradeable<TestPropsToken>("TestPropsToken", deployer, [
      PROPS_TOKEN_AMOUNT,
    ]);
    contractAddresses.propsToken = propsToken.address;

    appTokenLogic = await deployContract<AppToken>("AppToken", deployer);
    contractAddresses.appTokenLogic = appTokenLogic.address;

    appTokenStakingLogic = await deployContract<Staking>("Staking", deployer);
    contractAddresses.appTokenStakingLogic = appTokenStakingLogic.address;

    propsController = await deployContractUpgradeable<PropsController>(
      "PropsController",
      deployer,
      [
        propsControllerOwner.address,
        propsTreasury.address,
        propsGuardian.address,
        propsToken.address,
        appTokenLogic.address,
        appTokenStakingLogic.address,
      ]
    );
    contractAddresses.propsController = propsController.address;

    rPropsToken = await deployContractUpgradeable<RPropsToken>("RPropsToken", deployer, [
      propsController.address,
      propsToken.address,
    ]);
    contractAddresses.rPropsToken = rPropsToken.address;

    sPropsToken = await deployContractUpgradeable<SPropsToken>("SPropsToken", deployer, [
      propsController.address,
    ]);
    contractAddresses.sPropsToken = sPropsToken.address;

    sPropsAppStaking = await deployContractUpgradeable("Staking", deployer, [
      propsController.address,
      rPropsToken.address,
      rPropsToken.address,
      propsController.address,
      DAILY_REWARDS_EMISSION,
    ]);
    contractAddresses.sPropsAppStaking = sPropsAppStaking.address;

    sPropsUserStaking = await deployContractUpgradeable("Staking", deployer, [
      propsController.address,
      rPropsToken.address,
      rPropsToken.address,
      propsController.address,
      DAILY_REWARDS_EMISSION,
    ]);
    contractAddresses.sPropsUserStaking = sPropsUserStaking.address;

    console.log("Deployment successfully done!");

    console.log("Initializing contracts state...");

    // The rProps token contract is allowed to mint new Props
    await propsToken.connect(deployer).setMinter(rPropsToken.address, { gasLimit: 1000000 });

    // Initialize all needed fields on the controller
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
