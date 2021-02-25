import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import * as fs from "fs";
import { ethers } from "hardhat";

import type { AppPointsL1, AppProxyFactoryL1, AppProxyFactoryBridgeL1 } from "../typechain";
import { deployContract, deployContractUpgradeable } from "../utils";

// Matic contracts
const MATIC_CHECKPOINT_MANAGER_ADDRESS = process.env.TESTNET
  ? "0x2890bA17EfE978480615e330ecB65333b880928e"
  : ""; // TODO: Support mainnet;
const MATIC_FX_ROOT_ADDRESS = process.env.TESTNET
  ? "0x3d1d3E34f7fB6D26245E6640E1c50710eFFf15bA"
  : ""; // TODO: Support mainnet;

// Accounts
let deployer: SignerWithAddress;
let controller: SignerWithAddress;
let treasury: SignerWithAddress;

// Contracts
let appPointsLogic: AppPointsL1;
let appProxyFactory: AppProxyFactoryL1;
let appProxyFactoryBridge: AppProxyFactoryBridgeL1;

async function main() {
  [deployer, controller, treasury] = await ethers.getSigners();

  console.log("Using the following addresses:");
  console.log(`Deployer - ${deployer.address}`);
  console.log(`Controller - ${controller.address}`);
  console.log(`Treasury - ${treasury.address}`);

  const [l1Network, l2Network] = [process.env.L1_NETWORK, process.env.L2_NETWORK];

  if (process.env.DEPLOY) {
    if (!fs.existsSync(`deployments/${l1Network}.json`)) {
      console.log("Couldn't find any existing deployment, starting new deployment...");

      const addresses: any = {};

      console.log("Deploying `AppPointsL1` logic");
      appPointsLogic = await deployContract("AppPointsL1", deployer);
      addresses["appPointsLogic"] = appPointsLogic.address;

      console.log("Deploying `AppProxyFactoryL1`");
      appProxyFactory = await deployContractUpgradeable(
        "AppProxyFactoryL1",
        deployer,
        controller.address,
        treasury.address,
        appPointsLogic.address
      );
      addresses["appProxyFactory"] = appProxyFactory.address;

      console.log("Deploying `AppProxyFactoryBridgeL1`");
      appProxyFactoryBridge = await deployContract(
        "AppProxyFactoryBridgeL1",
        deployer,
        MATIC_CHECKPOINT_MANAGER_ADDRESS,
        MATIC_FX_ROOT_ADDRESS,
        appProxyFactory.address
      );
      addresses["appProxyFactoryBridge"] = appProxyFactoryBridge.address;

      console.log("Connecting `AppProxyFactoryL1` to `AppProxyFactoryBridgeL1`");
      await appProxyFactory
        .connect(controller)
        .changeAppProxyFactoryBridge(appProxyFactoryBridge.address)
        .then((tx: any) => tx.wait());

      if (!fs.existsSync("deployments")) {
        fs.mkdirSync("deployments");
      }
      fs.writeFileSync(`deployments/${l1Network}.json`, JSON.stringify(addresses, null, 2));
    } else {
      console.log("Contracts already deployed, skipping...");
    }
  } else {
    const l1Addresses = JSON.parse(fs.readFileSync(`deployments/${l1Network}.json`).toString());
    const l2Addresses = JSON.parse(fs.readFileSync(`deployments/${l2Network}.json`).toString());

    if (process.env.CONNECT) {
      console.log("Connecting `AppProxyFactoryBridgeL1` to `AppProxyFactoryBridgeL2`");
      appProxyFactoryBridge = (
        await ethers.getContractFactory("AppProxyFactoryBridgeL1", deployer)
      ).attach(l1Addresses["appProxyFactoryBridge"]) as AppProxyFactoryBridgeL1;
      await appProxyFactoryBridge
        .connect(deployer)
        .setFxChildTunnel(l2Addresses["appProxyFactoryBridge"])
        .then((tx: any) => tx.wait());
    }

    // if (process.env.TEST) {
    //   console.log("Deploying test app");
    //   appProxyFactory = (await ethers.getContractFactory("AppProxyFactoryL1", deployer)).attach(
    //     l1Addresses.appProxyFactory
    //   ) as AppProxyFactoryL1;
    //   await appProxyFactory
    //     .connect(controller)
    //     .deployApp("Test", "TST", expandTo18Decimals(10000), misc.address, bn(3658).mul(1e11));
    // }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.log(error);
    process.exit(1);
  });
