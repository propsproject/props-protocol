import { ContractTransaction } from "@ethersproject/contracts";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import * as fs from "fs";
import { ethers, upgrades } from "hardhat";

import type { AppProxyFactoryL2, PropsProtocol, PropsTokenL2 } from "../../typechain";

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

  console.log("Transferring `PropsTokenL2` ownership to the controller multisig");
  propsToken = (await ethers.getContractFactory("PropsTokenL2", deployer)).attach(
    l2Addresses["propsToken"]
  ) as PropsTokenL2;
  await propsToken
    .connect(controller)
    .transferOwnership(`${process.env.CONTROLLER_MULTISIG_L2}`)
    .then((tx: ContractTransaction) => tx.wait());

  console.log("Transferring `AppProxyFactoryL2` control to the controller multisig");
  appProxyFactory = (await ethers.getContractFactory("AppProxyFactoryL2", deployer)).attach(
    l2Addresses["appProxyFactory"]
  ) as AppProxyFactoryL2;
  await appProxyFactory
    .connect(controller)
    .transferControl(`${process.env.CONTROLLER_MULTISIG_L2}`)
    .then((tx: ContractTransaction) => tx.wait());

  console.log("Transferring `PropsProtocol` control to the controller multisig");
  propsProtocol = (await ethers.getContractFactory("PropsProtocol", deployer)).attach(
    l2Addresses["propsProtocol"]
  ) as PropsProtocol;
  await propsProtocol
    .connect(controller)
    .transferControl(`${process.env.CONTROLLER_MULTISIG_L2}`)
    .then((tx: ContractTransaction) => tx.wait());

  console.log("Transferring `ProxyAdmin` ownership to the controller multisig");
  await upgrades.admin.transferProxyAdminOwnership(`${process.env.CONTROLLER_MULTISIG_L2}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.log(error);
    process.exit(1);
  });
