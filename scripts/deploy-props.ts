import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { ethers, upgrades } from "hardhat";

import type { AppToken, PropsController, RPropsToken, Staking, TestPropsToken } from "../typechain";
import { bn, deployContract, deployContractUpgradeable, expandTo18Decimals } from "../utils";

const PROPS_TOKEN_AMOUNT = expandTo18Decimals(900000000);
const DAILY_REWARDS_EMISSION = bn(3658).mul(1e11);

let deployer: SignerWithAddress;
let propsControllerOwner: SignerWithAddress;
let propsTreasury: SignerWithAddress;

let propsToken: TestPropsToken;
let appTokenLogic: AppToken;
let appTokenStakingLogic: Staking;
let propsController: PropsController;
let rPropsToken: RPropsToken;
let sPropsAppStaking: Staking;
let sPropsUserStaking: Staking;

// Deploys new instances of all contracts
async function deployNewContracts() {
  // Deploy a test version of the Props token
  propsToken = await deployContractUpgradeable<TestPropsToken>("TestPropsToken", deployer, [
    PROPS_TOKEN_AMOUNT,
  ]);
  console.log(`propsToken: ${propsToken.address}`);

  // Deploy app token logic contract
  appTokenLogic = await deployContract<AppToken>("AppToken", deployer);
  console.log(`appTokenLogic: ${appTokenLogic.address}`);

  // Deploy app token staking logic contract
  appTokenStakingLogic = await deployContract<Staking>("Staking", deployer);
  console.log(`appTokenStakingLogic: ${appTokenStakingLogic.address}`);

  // Deploy the Props controller
  propsController = await deployContractUpgradeable<PropsController>("PropsController", deployer, [
    propsControllerOwner.address,
    propsTreasury.address,
    propsToken.address,
    appTokenLogic.address,
    appTokenStakingLogic.address,
  ]);
  console.log(`propsController: ${propsController.address}`);

  // Deploy the rProps token
  rPropsToken = await deployContractUpgradeable<RPropsToken>("RPropsToken", deployer, [
    propsController.address,
    propsToken.address,
  ]);
  console.log(`rPropsToken: ${rPropsToken.address}`);

  // Deploy the sProps staking contract for app rewards
  sPropsAppStaking = await deployContractUpgradeable("Staking", deployer, [
    propsController.address,
    rPropsToken.address,
    rPropsToken.address,
    propsController.address,
    DAILY_REWARDS_EMISSION,
  ]);
  console.log(`sPropsAppStaking: ${sPropsAppStaking.address}`);

  // Deploy the sProps staking contract for user rewards
  sPropsUserStaking = await deployContractUpgradeable("Staking", deployer, [
    propsController.address,
    rPropsToken.address,
    rPropsToken.address,
    propsController.address,
    DAILY_REWARDS_EMISSION,
  ]);
  console.log(`sPropsUserStaking: ${sPropsUserStaking.address}`);
}

// Connects to existing instances of the contracts
async function connectToContracts() {
  const propsTokenAddress = "0xC7Be1Db599a06C2e512cdfac9Bf88B891843F0c7";
  const appTokenLogicAddress = "0x2Dd48B75F5bd942C60876B5CF67b8e3711EE3807";
  const appTokenStakingLogicAddress = "0xdB535E713450e927c02a0781C31b142B1d6aFA04";
  const propsControllerAddress = "0x759A8Ce85580C6c281ce37050e7caf852B9b5c1a";
  const rPropsTokenAddress = "0x80376a3BfEE17Bdbf945172Cd5CCE25B0F7cC29f";
  const sPropsAppStakingAddress = "0xAe6720ddeD95a1fBFcAf87d943e8A4D22a0f3FeB";
  const sPropsUserStakingAddress = "0x11A71F6dE0D7B414FB95648936Fa441E92B33334";

  propsToken = (await ethers.getContractFactory("TestPropsToken")).attach(
    propsTokenAddress
  ) as TestPropsToken;

  appTokenLogic = (await ethers.getContractFactory("AppToken")).attach(
    appTokenLogicAddress
  ) as AppToken;

  appTokenStakingLogic = (await ethers.getContractFactory("Staking")).attach(
    appTokenStakingLogicAddress
  ) as Staking;

  propsController = (await ethers.getContractFactory("PropsController")).attach(
    propsControllerAddress
  ) as PropsController;

  rPropsToken = (await ethers.getContractFactory("RPropsToken")).attach(
    rPropsTokenAddress
  ) as RPropsToken;

  sPropsAppStaking = (await ethers.getContractFactory("Staking")).attach(
    sPropsAppStakingAddress
  ) as Staking;

  sPropsUserStaking = (await ethers.getContractFactory("Staking")).attach(
    sPropsUserStakingAddress
  ) as Staking;
}

async function initializeParameters() {
  // The rProps token contract is allowed to mint new Props
  await propsToken.connect(deployer).setMinter(rPropsToken.address, { gasLimit: 1000000 });

  // Initialize all needed fields on the controller
  await propsController
    .connect(propsControllerOwner)
    .setRPropsToken(rPropsToken.address, { gasLimit: 1000000 });
  await propsController
    .connect(propsControllerOwner)
    .setSPropsAppStaking(sPropsAppStaking.address, { gasLimit: 1000000 });
  await propsController
    .connect(propsControllerOwner)
    .setSPropsUserStaking(sPropsUserStaking.address, { gasLimit: 1000000 });

  // Distribute the rProps rewards to the sProps staking contracts
  await propsController
    .connect(propsControllerOwner)
    .distributePropsRewards(bn(800000), bn(200000), { gasLimit: 1000000 });
}

async function main() {
  [deployer, propsControllerOwner, propsTreasury] = await ethers.getSigners();

  console.log(`deployer: ${deployer.address}`);
  console.log(`propsControllerOwner: ${propsControllerOwner.address}`);
  console.log(`propsTreasury: ${propsTreasury.address}`);

  await deployNewContracts();
  // await connectToContracts();
  await initializeParameters();
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.log(error);
    process.exit(1);
  });
