import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import * as fs from "fs";
import { ethers } from "hardhat";

import type { AppPointsL1, AppProxyFactoryL1, AppProxyFactoryBridgeL1 } from "../../typechain";
import { bn, deployContract, deployContractUpgradeable, expandTo18Decimals } from "../../utils";

// Matic contracts
const MATIC_ROOT_CHAIN_ADDRESS = process.env.TESTNET
  ? "0x2890bA17EfE978480615e330ecB65333b880928e"
  : "0x86E4Dc95c7FBdBf52e33D563BbDB00823894C287";
const MATIC_FX_ROOT_ADDRESS = process.env.TESTNET
  ? "0x3d1d3E34f7fB6D26245E6640E1c50710eFFf15bA"
  : "0xfe5e5D361b2ad62c541bAb87C45a0B9B018389a2";

// Accounts
let deployer: SignerWithAddress;
let controller: SignerWithAddress;

// Contracts
let appPointsLogic: AppPointsL1;
let appProxyFactory: AppProxyFactoryL1;
let appProxyFactoryBridge: AppProxyFactoryBridgeL1;

async function main() {
  [deployer, controller] = await ethers.getSigners();

  const [l1Network, l2Network] = [`${process.env.L1_NETWORK}`, `${process.env.L2_NETWORK}`];
  if (process.env.DEPLOY) {
    console.log("Starting deployment...");

    const addresses: any = {};

    console.log("Deploying `AppPointsL1` logic");
    appPointsLogic = await deployContract("AppPointsL1", deployer);
    addresses["appPointsLogic"] = appPointsLogic.address;

    console.log("Deploying `AppProxyFactoryL1`");
    appProxyFactory = await deployContractUpgradeable(
      "AppProxyFactoryL1",
      deployer,
      controller.address,
      `${process.env.TREASURY_ADDRESS}`,
      appPointsLogic.address
    );
    addresses["appProxyFactory"] = appProxyFactory.address;

    console.log("Deploying `AppProxyFactoryBridgeL1`");
    appProxyFactoryBridge = await deployContract(
      "AppProxyFactoryBridgeL1",
      deployer,
      MATIC_ROOT_CHAIN_ADDRESS,
      MATIC_FX_ROOT_ADDRESS,
      appProxyFactory.address
    );
    addresses["appProxyFactoryBridge"] = appProxyFactoryBridge.address;

    console.log("Connecting `AppProxyFactoryL1` to `AppProxyFactoryBridgeL1`");
    await appProxyFactory
      .connect(controller)
      .changeAppProxyFactoryBridge(appProxyFactoryBridge.address)
      .then((tx) => tx.wait());

    console.log("Deployment succedded...");

    if (!fs.existsSync("deployments")) {
      fs.mkdirSync("deployments");
    }
    if (!fs.existsSync(`deployments/${l1Network}.json`)) {
      fs.writeFileSync(`deployments/${l1Network}.json`, JSON.stringify([addresses], null, 2));
    } else {
      const previousDeployments = JSON.parse(
        fs.readFileSync(`deployments/${l1Network}.json`).toString()
      );
      fs.writeFileSync(
        `deployments/${l1Network}.json`,
        JSON.stringify([...previousDeployments, addresses], null, 2)
      );
    }
  } else {
    const l1Addresses = JSON.parse(
      fs.readFileSync(`deployments/${l1Network}.json`).toString()
    ).slice(-1)[0];
    const l2Addresses = JSON.parse(
      fs.readFileSync(`deployments/${l2Network}.json`).toString()
    ).slice(-1)[0];

    if (process.env.CONNECT) {
      console.log("Connecting `AppProxyFactoryBridgeL1` to `AppProxyFactoryBridgeL2`");
      appProxyFactoryBridge = (
        await ethers.getContractFactory("AppProxyFactoryBridgeL1", deployer)
      ).attach(l1Addresses["appProxyFactoryBridge"]) as AppProxyFactoryBridgeL1;
      await appProxyFactoryBridge
        .connect(deployer)
        .setFxChildTunnel(l2Addresses["appProxyFactoryBridge"])
        .then((tx) => tx.wait());
    }

    // if (process.env.TEST) {
    //   console.log("Deploying test app");
    //   appProxyFactory = (await ethers.getContractFactory("AppProxyFactoryL1", deployer)).attach(
    //     l1Addresses["appProxyFactory"]
    //   ) as AppProxyFactoryL1;
    //   await appProxyFactory
    //     .connect(deployer)
    //     .deployApp(
    //       "Test",
    //       "TEST",
    //       expandTo18Decimals(1000000),
    //       deployer.address,
    //       bn(3658).mul(1e11)
    //     )
    //     .then((tx) => tx.wait());
    // }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.log(error);
    process.exit(1);
  });
