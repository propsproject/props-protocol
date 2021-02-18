import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import * as fs from "fs";
import { ethers } from "hardhat";

import type {
  AppPointsL1,
  AppProxyFactoryL1,
  AppProxyFactoryBridgeL1,
  PropsTokenBridgeL1,
  TestPropsToken,
} from "../typechain";
import { bn, deployContract, deployContractUpgradeable, expandTo18Decimals } from "../utils";

// Constants
const PROPS_TOKEN_AMOUNT = expandTo18Decimals(900000000);
// Taken from https://docs.matic.network/docs/develop/network-details/genesis-contracts
// TODO: Support mainnet
const CHECKPOINT_MANAGER_ADDRESS = "0x2890bA17EfE978480615e330ecB65333b880928e";
// Taken from https://github.com/jdkanani/fx-portal
// TODO: Support mainnet
const FX_ROOT_ADDRESS = "0x3d1d3E34f7fB6D26245E6640E1c50710eFFf15bA";

// Accounts
let deployer: SignerWithAddress;
let controller: SignerWithAddress;
let treasury: SignerWithAddress;
let misc: SignerWithAddress;

// Contracts
let propsToken: TestPropsToken;
let propsTokenBridge: PropsTokenBridgeL1;
let appPointsLogic: AppPointsL1;
let appProxyFactory: AppProxyFactoryL1;
let appProxyFactoryBridge: AppProxyFactoryBridgeL1;

async function main() {
  [deployer, controller, treasury, misc] = await ethers.getSigners();

  const [l1Network, l2Network] = [process.env.L1_NETWORK, process.env.L2_NETWORK];

  console.log("Using the following addresses:");
  console.log(`Deployer - ${deployer.address}`);
  console.log(`Controller - ${controller.address}`);
  console.log(`Treasury - ${treasury.address}`);
  console.log(`Misc - ${misc.address}`);

  if (process.env.DEPLOY) {
    if (!fs.existsSync(`${l1Network}.json`)) {
      const addresses: any = {};

      console.log("Starting deployment...");

      console.log("Deploying `PropsToken`");
      propsToken = await deployContractUpgradeable("TestPropsToken", deployer, PROPS_TOKEN_AMOUNT);
      addresses["propsToken"] = propsToken.address;

      console.log("Deploying `PropsTokenBridge`");
      propsTokenBridge = await deployContract(
        "PropsTokenBridgeL1",
        deployer,
        CHECKPOINT_MANAGER_ADDRESS,
        FX_ROOT_ADDRESS,
        propsToken.address
      );
      addresses["propsTokenBridge"] = propsTokenBridge.address;

      console.log("Connecting `PropsToken` to `PropsTokenBridge`");
      await propsToken.connect(deployer).addMinter(propsTokenBridge.address);

      console.log("Deploying `AppPoints` logic");
      appPointsLogic = await deployContract("AppPointsL1", deployer);
      addresses["appPointsLogic"] = appPointsLogic.address;

      console.log("Deploying `AppProxyFactory`");
      appProxyFactory = await deployContractUpgradeable(
        "AppProxyFactoryL1",
        deployer,
        controller.address,
        treasury.address,
        appPointsLogic.address
      );
      addresses["appProxyFactory"] = appProxyFactory.address;

      console.log("Deploying `AppProxyFactoryBridge`");
      appProxyFactoryBridge = await deployContract(
        "AppProxyFactoryBridgeL1",
        deployer,
        CHECKPOINT_MANAGER_ADDRESS,
        FX_ROOT_ADDRESS,
        appProxyFactory.address
      );
      addresses["appProxyFactoryBridge"] = appProxyFactoryBridge.address;

      console.log("Connecting `AppProxyFactory` to `AppProxyFactoryBridge`");
      await appProxyFactory
        .connect(controller)
        .changeAppProxyFactoryBridge(appProxyFactoryBridge.address);

      fs.writeFileSync(`${l1Network}.json`, JSON.stringify(addresses, null, 2));
    } else {
      console.log("Contracts already deployed, skipping...");
    }
  } else {
    const l1Addresses = JSON.parse(fs.readFileSync(`${l1Network}.json`).toString());
    const l2Addresses = JSON.parse(fs.readFileSync(`${l2Network}.json`).toString());

    if (process.env.CONNECT) {
      console.log("Connecting `PropsTokenBridge` to L2");
      propsTokenBridge = (await ethers.getContractFactory("PropsTokenBridgeL1", deployer)).attach(
        l1Addresses.propsTokenBridge
      ) as PropsTokenBridgeL1;
      await propsTokenBridge.connect(deployer).setFxChildTunnel(l2Addresses.propsTokenBridge);

      console.log("Connecting `AppProxyFactoryBridge` to L2");
      appProxyFactoryBridge = (
        await ethers.getContractFactory("AppProxyFactoryBridgeL1", deployer)
      ).attach(l1Addresses.appProxyFactoryBridge) as AppProxyFactoryBridgeL1;
      await appProxyFactoryBridge
        .connect(deployer)
        .setFxChildTunnel(l2Addresses.appProxyFactoryBridge);
    } else if (process.env.TEST) {
      console.log("Moving Props across the bridge");
      propsToken = (await ethers.getContractFactory("TestPropsToken", deployer)).attach(
        l1Addresses.propsToken
      ) as TestPropsToken;
      propsTokenBridge = (await ethers.getContractFactory("PropsTokenBridgeL1", deployer)).attach(
        l1Addresses.propsTokenBridge
      ) as PropsTokenBridgeL1;
      await propsToken.connect(deployer).approve(propsTokenBridge.address, expandTo18Decimals(100));
      // TODO: Investigate flakiness
      await new Promise((resolve) => setTimeout(resolve, 10000));
      await propsTokenBridge.connect(deployer).deposit(deployer.address, expandTo18Decimals(100));

      console.log("Deploying test app");
      appProxyFactory = (await ethers.getContractFactory("AppProxyFactoryL1", deployer)).attach(
        l1Addresses.appProxyFactory
      ) as AppProxyFactoryL1;
      await appProxyFactory
        .connect(controller)
        .deployApp("Test", "TST", expandTo18Decimals(10000), misc.address, bn(3658).mul(1e11));
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.log(error);
    process.exit(1);
  });
