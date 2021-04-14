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
} from "../../typechain";
import { bn, deployContract, deployContractUpgradeable, expandTo18Decimals } from "../../utils";

// Constants
const APP_PROPS_DAILY_REWARDS_EMISSION = bn(3658).mul(1e11);
const USER_PROPS_DAILY_REWARDS_EMISSION = bn(1e14);

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

  const [l1Network, l2Network] = [`${process.env.L1_NETWORK}`, `${process.env.L2_NETWORK}`];
  if (process.env.DEPLOY) {
    console.log("Starting deployment...");

    const addresses: any = {};

    console.log("Deploying `PropsTokenL2`");
    propsToken = await deployContractUpgradeable("PropsTokenL2", deployer, controller.address);
    // propsToken = (await ethers.getContractFactory("PropsTokenL2")).attach("") as PropsTokenL2;
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
      APP_PROPS_DAILY_REWARDS_EMISSION
    );
    addresses["propsAppStaking"] = propsAppStaking.address;

    console.log("Deploying user Props `Staking`");
    propsUserStaking = await deployContractUpgradeable(
      "Staking",
      deployer,
      propsProtocol.address,
      rPropsToken.address,
      rPropsToken.address,
      USER_PROPS_DAILY_REWARDS_EMISSION
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
      .then((tx) => tx.wait());

    console.log("Setting required parameters on the contracts");
    await propsToken
      .connect(controller)
      .addMinter(rPropsToken.address)
      .then((tx) => tx.wait());
    await propsProtocol
      .connect(controller)
      .setAppProxyFactory(appProxyFactory.address)
      .then((tx) => tx.wait());
    await propsProtocol
      .connect(controller)
      .setRPropsToken(rPropsToken.address)
      .then((tx) => tx.wait());
    await propsProtocol
      .connect(controller)
      .setSPropsToken(sPropsToken.address)
      .then((tx) => tx.wait());
    await propsProtocol
      .connect(controller)
      .setPropsAppStaking(propsAppStaking.address)
      .then((tx) => tx.wait());
    await propsProtocol
      .connect(controller)
      .setPropsUserStaking(propsUserStaking.address)
      .then((tx) => tx.wait());

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
        .then((tx) => tx.wait());
    }

    if (process.env.TEST) {
      console.log("Permissioning controller as minter on `PropsTokenL2`");
      propsToken = (await ethers.getContractFactory("PropsTokenL2", deployer)).attach(
        l2Addresses["propsToken"]
      ) as PropsTokenL2;
      await propsToken
        .connect(controller)
        .addMinter(controller.address)
        .then((tx) => tx.wait());

      console.log("Minting Props tokens on L2");
      await propsToken
        .connect(controller)
        .mint("0x6E4A0a74D85B7053176b3ad95358a3185190E4Dc", expandTo18Decimals(1000000))
        .then((tx) => tx.wait());
      await propsToken
        .connect(controller)
        .mint("0xA30C032f2995aCA0e180dd0D27f996c6f1662D7d", expandTo18Decimals(1000000))
        .then((tx) => tx.wait());
      await propsToken
        .connect(controller)
        .mint("0xBaeC4F55b566D7743c83e4D6BFD78a0593ad8047", expandTo18Decimals(1000000))
        .then((tx) => tx.wait());
      await propsToken
        .connect(controller)
        .mint("0xACC92F8a8236971B83477315068702dC687d5D55", expandTo18Decimals(1000000))
        .then((tx) => tx.wait());
      await propsToken
        .connect(controller)
        .mint("0xf18E1378Ff4ec37e7d1eD3aDa9912f24527D24fA", expandTo18Decimals(1000000))
        .then((tx) => tx.wait());
      await propsToken
        .connect(controller)
        .mint("0x4De4279596Ba064fD30275C6982DCbf01bc79EeF", expandTo18Decimals(10000000))
        .then((tx) => tx.wait());

      console.log("Distributing Props rewards");
      propsProtocol = (await ethers.getContractFactory("PropsProtocol", deployer)).attach(
        l2Addresses["propsProtocol"]
      ) as PropsProtocol;
      await propsProtocol
        .connect(controller)
        .changeDailyUserRewardEmission(ethers.utils.parseEther("0.1").div(100))
        .then((tx) => tx.wait());
      await propsProtocol
        .connect(controller)
        .distributePropsRewards(expandTo18Decimals(100000000), bn(200000), bn(800000))
        .then((tx) => tx.wait());

      for (const [appPointsAddress, appPointsStakingAddress] of [
        [
          "0x5f473dabe0b31475607faf6c163bcf0b100f40a2",
          "0x2c9aa8631e1610771afc0e7e2597e4c3875253b7",
        ],
        [
          "0x8a513383b40fa5f26e2cfd9233046a94e5fa1ec0",
          "0xf4a29b6064ad469a4c3ec02425929a97e8d30633",
        ],
        [
          "0x9ba3f765eeded1a173e4302cb9b26ddb62f1b4af",
          "0x6cce52a4d129034d24430e3c0d4d9a0acf12df45",
        ],
      ]) {
        console.log("Minting AppPoints");
        const appPoints = (await ethers.getContractFactory("AppPointsL2", deployer)).attach(
          appPointsAddress
        ) as AppPointsL2;
        await appPoints
          .connect(controller)
          .setMinter(controller.address)
          .then((tx) => tx.wait());
        await appPoints
          .connect(controller)
          .deposit(
            appPointsStakingAddress,
            new ethers.utils.AbiCoder().encode(["uint256"], [expandTo18Decimals(100000000)])
          )
          .then((tx) => tx.wait());

        console.log("Distributin AppPoints rewards");
        const appPointsStaking = (await ethers.getContractFactory("Staking", deployer)).attach(
          appPointsStakingAddress
        ) as Staking;
        await appPointsStaking
          .connect(controller)
          .notifyRewardAmount(expandTo18Decimals(100000000))
          .then((tx) => tx.wait());
      }
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.log(error);
    process.exit(1);
  });
