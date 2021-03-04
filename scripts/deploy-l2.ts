import { ContractTransaction } from "@ethersproject/contracts";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import * as fs from "fs";
import { ethers } from "hardhat";

import type {
  AppPointsL2,
  AppProxyFactoryL2,
  AppProxyFactoryBridgeL2,
  Staking,
  PropsTokenL2,
  PropsProtocol,
  RPropsToken,
  SPropsToken,
} from "../typechain";
import { bn, deployContract, deployContractUpgradeable } from "../utils";

// Constants
const DAILY_REWARDS_EMISSION = bn(3658).mul(1e11);

// Matic contracts
const MATIC_FX_CHILD_ADDRESS = process.env.TESTNET
  ? "0xCf73231F28B7331BBe3124B907840A94851f9f11"
  : "0x8397259c983751DAf40400790063935a11afa28a";

// Accounts
let deployer: SignerWithAddress;
let controller: SignerWithAddress;

// Contracts
let propsToken: PropsTokenL2;
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
  [deployer, controller] = await ethers.getSigners();

  const [l1Network, l2Network] = [process.env.L1_NETWORK, process.env.L2_NETWORK];
  if (process.env.DEPLOY) {
    console.log("Starting deployment...");

    const addresses: any = {};

    console.log("Deploying `PropsTokenL2`");
    propsToken = await deployContractUpgradeable("PropsTokenL2", deployer, controller.address);
    addresses["propsToken"] = propsToken.address;

    console.log("Deploying `PropsProtocol`");
    propsProtocol = await deployContractUpgradeable(
      "PropsProtocol",
      deployer,
      controller.address,
      `${process.env.GUARDIAN_ADDRESS}`,
      propsToken.address
    );
    addresses["propsProtocol"] = propsProtocol.address;

    console.log("Deploying `RPropsToken`");
    rPropsToken = await deployContractUpgradeable(
      "RPropsToken",
      deployer,
      propsProtocol.address,
      propsToken.address
    );
    addresses["rPropsToken"] = rPropsToken.address;

    console.log("Deploying `SPropsToken`");
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

    console.log("Deploying `AppPointsL2` logic");
    appPointsLogic = await deployContract("AppPointsL2", deployer);
    addresses["appPointsLogic"] = appPointsLogic.address;

    console.log("Deploying `Staking` logic");
    appPointsStakingLogic = await deployContract("Staking", deployer);
    addresses["appPointsStakingLogic"] = appPointsStakingLogic.address;

    console.log("Deploying `AppProxyFactoryL2`");
    appProxyFactory = await deployContractUpgradeable(
      "AppProxyFactoryL2",
      deployer,
      controller.address,
      propsProtocol.address,
      propsToken.address,
      appPointsLogic.address,
      appPointsStakingLogic.address
    );
    addresses["appProxyFactory"] = appProxyFactory.address;

    console.log("Deploying `AppProxyFactoryBridgeL2`");
    appProxyFactoryBridge = await deployContract(
      "AppProxyFactoryBridgeL2",
      deployer,
      MATIC_FX_CHILD_ADDRESS,
      appProxyFactory.address
    );
    addresses["appProxyFactoryBridge"] = appProxyFactoryBridge.address;

    console.log("Connecting `AppProxyFactoryL2` to `AppProxyFactoryBridgeL2`");
    await appProxyFactory
      .connect(controller)
      .changeAppProxyFactoryBridge(appProxyFactoryBridge.address)
      .then((tx: ContractTransaction) => tx.wait());

    console.log("Setting required parameters on the contracts");
    await propsToken
      .connect(controller)
      .addMinter(rPropsToken.address)
      .then((tx: ContractTransaction) => tx.wait());
    await propsProtocol
      .connect(controller)
      .setAppProxyFactory(appProxyFactory.address)
      .then((tx: ContractTransaction) => tx.wait());
    await propsProtocol
      .connect(controller)
      .setRPropsToken(rPropsToken.address)
      .then((tx: ContractTransaction) => tx.wait());
    await propsProtocol
      .connect(controller)
      .setSPropsToken(sPropsToken.address)
      .then((tx: ContractTransaction) => tx.wait());
    await propsProtocol
      .connect(controller)
      .setPropsAppStaking(propsAppStaking.address)
      .then((tx: ContractTransaction) => tx.wait());
    await propsProtocol
      .connect(controller)
      .setPropsUserStaking(propsUserStaking.address)
      .then((tx: ContractTransaction) => tx.wait());

    console.log("Deployment succedded...");

    if (!fs.existsSync("deployments")) {
      fs.mkdirSync("deployments");
    }
    if (!fs.existsSync(`deployments/${l2Network}.json`)) {
      fs.writeFileSync(`deployments/${l2Network}.json`, JSON.stringify([addresses], null, 2));
    } else {
      const previousDeployments = JSON.parse(
        fs.readFileSync(`deployments/${l2Network}.json`).toString()
      );
      fs.writeFileSync(
        `deployments/${l2Network}.json`,
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
      console.log("Connecting `AppProxyFactoryBridgeL2` to `AppProxyFactoryBridgeL1`");
      appProxyFactoryBridge = (
        await ethers.getContractFactory("AppProxyFactoryBridgeL2", deployer)
      ).attach(l2Addresses["appProxyFactoryBridge"]) as AppProxyFactoryBridgeL2;
      await appProxyFactoryBridge
        .connect(deployer)
        .setFxRootTunnel(l1Addresses["appProxyFactoryBridge"])
        .then((tx: ContractTransaction) => tx.wait());
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.log(error);
    process.exit(1);
  });
