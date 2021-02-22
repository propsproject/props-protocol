import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import * as fs from "fs";
import { ethers } from "hardhat";

import type {
  AppPointsL2,
  AppProxyFactoryL2,
  AppProxyFactoryBridgeL2,
  Staking,
  TestPropsTokenL2,
  PropsProtocol,
  RPropsToken,
  SPropsToken,
} from "../typechain";
import { bn, deployContract, deployContractUpgradeable } from "../utils";

// Constants
const PROPS_TOKEN_AMOUNT = bn(0);
const DAILY_REWARDS_EMISSION = bn(3658).mul(1e11);
// Taken from https://github.com/jdkanani/fx-portal
// TODO: Support mainnet
const FX_CHILD_ADDRESS = "0xCf73231F28B7331BBe3124B907840A94851f9f11";
// Taken from https://github.com/maticnetwork/static/blob/master/network/testnet/mumbai/index.json
// TODO: Support mainnet
const CHILD_CHAIN_MANAGER_PROXY_ADDRESS = "0xb5505a6d998549090530911180f38aC5130101c6";

// Accounts
let deployer: SignerWithAddress;
let controller: SignerWithAddress;
let treasury: SignerWithAddress;
let guardian: SignerWithAddress;
let misc: SignerWithAddress;

// Contracts
let propsToken: TestPropsTokenL2;
let propsProtocol: PropsProtocol;
let rPropsToken: RPropsToken;
let sPropsToken: SPropsToken;
let propsAppStaking: Staking;
let propsUserStaking: Staking;
let appPointsLogic: AppPointsL2;
let appPointsStakingLogic: Staking;
let appProxyFactory: AppProxyFactoryL2;
let appProxyFactoryBridge: AppProxyFactoryBridgeL2;

async function main() {
  [deployer, controller, treasury, guardian, misc] = await ethers.getSigners();

  const [l1Network, l2Network] = [process.env.L1_NETWORK, process.env.L2_NETWORK];

  console.log("Using the following addresses:");
  console.log(`Deployer - ${deployer.address}`);
  console.log(`Controller - ${controller.address}`);
  console.log(`Treasury - ${treasury.address}`);
  console.log(`Guardian - ${guardian.address}`);
  console.log(`Misc - ${misc.address}`);

  if (process.env.DEPLOY) {
    if (!fs.existsSync(`${l2Network}.json`)) {
      const addresses: any = {};

      console.log("Starting deployment...");

      console.log("Deploying `PropsToken`");
      propsToken = await deployContractUpgradeable(
        "TestPropsTokenL2",
        deployer,
        PROPS_TOKEN_AMOUNT,
        CHILD_CHAIN_MANAGER_PROXY_ADDRESS
      );
      addresses["propsToken"] = propsToken.address;

      console.log("Deploying `PropsProtocol`");
      propsProtocol = await deployContractUpgradeable(
        "PropsProtocol",
        deployer,
        controller.address,
        guardian.address,
        propsToken.address
      );
      addresses["propsProtocol"] = propsProtocol.address;

      console.log("Deploying `rPropsToken`");
      rPropsToken = await deployContractUpgradeable(
        "RPropsToken",
        deployer,
        propsProtocol.address,
        propsToken.address
      );
      addresses["rPropsToken"] = rPropsToken.address;

      console.log("Deploying `sPropsToken`");
      sPropsToken = await deployContractUpgradeable("SPropsToken", deployer, propsProtocol.address);
      addresses["sPropsToken"] = sPropsToken.address;

      console.log("Deploying app Props `Staking`");
      propsAppStaking = await deployContractUpgradeable(
        "Staking",
        deployer,
        propsProtocol.address,
        rPropsToken.address,
        rPropsToken.address,
        DAILY_REWARDS_EMISSION
      );
      addresses["propsAppStaking"] = propsAppStaking.address;

      console.log("Deploying user Props `Staking`");
      propsUserStaking = await deployContractUpgradeable(
        "Staking",
        deployer,
        propsProtocol.address,
        rPropsToken.address,
        rPropsToken.address,
        DAILY_REWARDS_EMISSION
      );
      addresses["propsUserStaking"] = propsUserStaking.address;

      console.log("Deploying `AppPoints` logic");
      appPointsLogic = await deployContract("AppPointsL2", deployer);
      addresses["appPointsLogic"] = appPointsLogic.address;

      console.log("Deploying `Staking` logic");
      appPointsStakingLogic = await deployContract("Staking", deployer);
      addresses["appPointsStakingLogic"] = appPointsStakingLogic.address;

      console.log("Deploying `AppProxyFactory`");
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
      addresses["appProxyFactory"] = appProxyFactory.address;

      console.log("Deploying `AppProxyFactoryBridge`");
      appProxyFactoryBridge = await deployContract(
        "AppProxyFactoryBridgeL2",
        deployer,
        FX_CHILD_ADDRESS,
        appProxyFactory.address
      );
      addresses["appProxyFactoryBridge"] = appProxyFactoryBridge.address;

      console.log("Connecting `AppProxyFactory` to `AppProxyFactoryBridge`");
      await appProxyFactory
        .connect(controller)
        .setAppProxyFactoryBridge(appProxyFactoryBridge.address);

      console.log("Setting required parameters");
      await propsToken.connect(deployer).setMinter(rPropsToken.address);
      await propsProtocol.connect(controller).setAppProxyFactory(appProxyFactory.address);
      await propsProtocol.connect(controller).setRPropsToken(rPropsToken.address);
      await propsProtocol.connect(controller).setSPropsToken(sPropsToken.address);
      await propsProtocol.connect(controller).setPropsAppStaking(propsAppStaking.address);
      await propsProtocol.connect(controller).setPropsUserStaking(propsUserStaking.address);

      fs.writeFileSync(`${l2Network}.json`, JSON.stringify(addresses, null, 2));
    } else {
      console.log("Contracts already deployed, skipping...");
    }
  } else {
    const l1Addresses = JSON.parse(fs.readFileSync(`${l1Network}.json`).toString());
    const l2Addresses = JSON.parse(fs.readFileSync(`${l2Network}.json`).toString());

    if (process.env.CONNECT) {
      console.log("Connecting `AppProxyFactoryBridge` to L1");
      appProxyFactoryBridge = (
        await ethers.getContractFactory("AppProxyFactoryBridgeL2", deployer)
      ).attach(l2Addresses.appProxyFactoryBridge) as AppProxyFactoryBridgeL2;
      await appProxyFactoryBridge
        .connect(deployer)
        .setFxRootTunnel(l1Addresses.appProxyFactoryBridge);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.log(error);
    process.exit(1);
  });
