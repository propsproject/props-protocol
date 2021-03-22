import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import * as fs from "fs";
import { ethers, upgrades } from "hardhat";

import type { AppProxyFactoryL2, PropsProtocol, PropsTokenL2 } from "../../typechain";

// Matic contracts
const MATIC_CHILD_CHAIN_MANAGER = process.env.TESTNET
  ? "0xb5505a6d998549090530911180f38aC5130101c6"
  : "0xA6FA4fB5f76172d178d61B04b0ecd319C5d1C0aa";

// Accounts
let deployer: SignerWithAddress;
let controller: SignerWithAddress;

// Contracts
let propsToken: PropsTokenL2;
let appProxyFactory: AppProxyFactoryL2;
let propsProtocol: PropsProtocol;

async function main() {
  [deployer, controller] = await ethers.getSigners();

  const l2Addresses = JSON.parse(
    fs.readFileSync(`deployments/${process.env.L2_NETWORK}.json`).toString()
  ).slice(-1)[0];

  console.log("Permissioning Matic bridge as minter on `PropsTokenL2`");
  propsToken = (await ethers.getContractFactory("PropsTokenL2", deployer)).attach(
    l2Addresses["propsToken"]
  ) as PropsTokenL2;
  await propsToken
    .connect(controller)
    .addMinter(MATIC_CHILD_CHAIN_MANAGER)
    .then((tx) => tx.wait());

  console.log("Transferring `PropsTokenL2` ownership to ControllerMultisigL2");
  await propsToken
    .connect(controller)
    .transferOwnership(`${process.env.CONTROLLER_MULTISIG_L2}`)
    .then((tx) => tx.wait());

  console.log("Transferring `AppProxyFactoryL2` control to ControllerMultisigL2");
  appProxyFactory = (await ethers.getContractFactory("AppProxyFactoryL2", deployer)).attach(
    l2Addresses["appProxyFactory"]
  ) as AppProxyFactoryL2;
  await appProxyFactory
    .connect(controller)
    .transferControl(`${process.env.CONTROLLER_MULTISIG_L2}`)
    .then((tx) => tx.wait());

  console.log("Transferring `PropsProtocol` control to ControllerMultisigL2");
  propsProtocol = (await ethers.getContractFactory("PropsProtocol", deployer)).attach(
    l2Addresses["propsProtocol"]
  ) as PropsProtocol;
  await propsProtocol
    .connect(controller)
    .transferControl(`${process.env.CONTROLLER_MULTISIG_L2}`)
    .then((tx) => tx.wait());

  console.log("Transferring protocol `ProxyAdmin` ownership to ControllerMultisigL2");
  await upgrades.admin.transferProxyAdminOwnership(`${process.env.CONTROLLER_MULTISIG_L2}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.log(error);
    process.exit(1);
  });
