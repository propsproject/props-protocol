import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import * as fs from "fs";
import { ethers } from "hardhat";

import type {
  AppPoints,
  AppProxyFactory,
  PropsProtocol,
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
let protocolOwner: SignerWithAddress;
let treasury: SignerWithAddress;
let guardian: SignerWithAddress;

// Contracts
let propsToken: TestPropsToken;
let sPropsToken: SPropsToken;
let rPropsToken: RPropsToken;
let propsProtocol: PropsProtocol;
let propsAppStaking: Staking;
let propsUserStaking: Staking;
let appPointsLogic: AppPoints;
let appPointsStakingLogic: Staking;
let appProxyFactory: AppProxyFactory;

async function main() {
  [deployer, protocolOwner, treasury, guardian] = await ethers.getSigners();

  console.log("Using the following addresses:");
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Protocol owner: ${protocolOwner.address}`);
  console.log(`Treasury: ${treasury.address}`);
  console.log(`Guardian: ${guardian.address}`);

  const network = (await ethers.provider.getNetwork()).name;

  console.log(`Detected network: ${network}`);

  if (fs.existsSync(`${network}.json`)) {
    console.log(`Contracts file found, connecting to deployed instances...`);

    // Connect to deployed contracts
    const contractAddresses = JSON.parse(fs.readFileSync(`${network}.json`).toString());

    propsToken = (await ethers.getContractFactory("TestPropsToken", deployer)).attach(
      contractAddresses.propsToken
    ) as TestPropsToken;

    propsProtocol = (await ethers.getContractFactory("PropsProtocol", deployer)).attach(
      contractAddresses.propsProtocol
    ) as PropsProtocol;

    rPropsToken = (await ethers.getContractFactory("RPropsToken")).attach(
      contractAddresses.rPropsToken
    ) as RPropsToken;

    sPropsToken = (await ethers.getContractFactory("SPropsToken")).attach(
      contractAddresses.sPropsToken
    ) as SPropsToken;

    propsAppStaking = (await ethers.getContractFactory("Staking")).attach(
      contractAddresses.propsAppStaking
    ) as Staking;

    propsUserStaking = (await ethers.getContractFactory("Staking")).attach(
      contractAddresses.propsUserStaking
    ) as Staking;

    appPointsLogic = (await ethers.getContractFactory("AppPoints")).attach(
      contractAddresses.appPointsLogic
    ) as AppPoints;

    appPointsStakingLogic = (await ethers.getContractFactory("Staking")).attach(
      contractAddresses.appPointsStakingLogic
    ) as Staking;

    appProxyFactory = (await ethers.getContractFactory("AppProxyFactory")).attach(
      contractAddresses.appProxyFactory
    ) as AppProxyFactory;

    console.log("Connected successfully!");
  } else {
    console.log("Contracts file not found, deploying new contract instances...");

    // Deploy new contracts
    const contractAddresses: any = {};

    propsToken = await deployContractUpgradeable("TestPropsToken", deployer, [PROPS_TOKEN_AMOUNT]);
    await propsToken.deployed();
    contractAddresses.propsToken = propsToken.address;

    propsProtocol = await deployContractUpgradeable("PropsProtocol", deployer, [
      protocolOwner.address,
      guardian.address,
      propsToken.address,
    ]);
    await propsProtocol.deployed();
    contractAddresses.propsProtocol = propsProtocol.address;

    rPropsToken = await deployContractUpgradeable("RPropsToken", deployer, [
      propsProtocol.address,
      propsToken.address,
    ]);
    await rPropsToken.deployed();
    contractAddresses.rPropsToken = rPropsToken.address;

    sPropsToken = await deployContractUpgradeable("SPropsToken", deployer, [propsProtocol.address]);
    await sPropsToken.deployed();
    contractAddresses.sPropsToken = sPropsToken.address;

    propsAppStaking = await deployContractUpgradeable("Staking", deployer, [
      propsProtocol.address,
      rPropsToken.address,
      rPropsToken.address,
      propsProtocol.address,
      DAILY_REWARDS_EMISSION,
    ]);
    await propsAppStaking.deployed();
    contractAddresses.propsAppStaking = propsAppStaking.address;

    propsUserStaking = await deployContractUpgradeable("Staking", deployer, [
      propsProtocol.address,
      rPropsToken.address,
      rPropsToken.address,
      propsProtocol.address,
      DAILY_REWARDS_EMISSION,
    ]);
    await propsUserStaking.deployed();
    contractAddresses.propsUserStaking = propsUserStaking.address;

    appPointsLogic = await deployContract("AppPoints", deployer);
    await appPointsLogic.deployed();
    contractAddresses.appPointsLogic = appPointsLogic.address;

    appPointsStakingLogic = await deployContract("Staking", deployer);
    await appPointsStakingLogic.deployed();
    contractAddresses.appPointsStakingLogic = appPointsStakingLogic.address;

    appProxyFactory = await deployContractUpgradeable("AppProxyFactory", deployer, [
      protocolOwner.address,
      propsProtocol.address,
      treasury.address,
      propsToken.address,
      appPointsLogic.address,
      appPointsStakingLogic.address,
    ]);
    await appProxyFactory.deployed();
    contractAddresses.appProxyFactory = appProxyFactory.address;

    console.log("Deployment successfully done!");

    console.log("Initializing contracts state...");

    // The rProps token contract is allowed to mint new Props
    await propsToken.connect(deployer).setMinter(rPropsToken.address);

    // Initialize all needed fields on the controller
    await propsProtocol.connect(protocolOwner).setAppProxyFactory(appProxyFactory.address);
    await propsProtocol.connect(protocolOwner).setRPropsToken(rPropsToken.address);
    await propsProtocol.connect(protocolOwner).setSPropsToken(sPropsToken.address);
    await propsProtocol.connect(protocolOwner).setPropsAppStaking(propsAppStaking.address);
    await propsProtocol.connect(protocolOwner).setPropsUserStaking(propsUserStaking.address);

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
