import { ContractTransaction } from "@ethersproject/contracts";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import * as fs from "fs";
import { ethers, upgrades } from "hardhat";

import type { AppProxyFactoryL1 } from "../../typechain";

// Accounts
let deployer: SignerWithAddress;
let controller: SignerWithAddress;

// Contracts
let appProxyFactory: AppProxyFactoryL1;

async function main() {
  [deployer, controller] = await ethers.getSigners();

  const l1Addresses = JSON.parse(
    fs.readFileSync(`deployments/${process.env.L1_NETWORK}.json`).toString()
  ).slice(-1)[0];

  console.log("Transferring `AppProxyFactoryL1` control to ControllerMultisigL1");
  appProxyFactory = (await ethers.getContractFactory("AppProxyFactoryL1", deployer)).attach(
    l1Addresses["appProxyFactory"]
  ) as AppProxyFactoryL1;
  appProxyFactory
    .connect(controller)
    .transferControl(`${process.env.CONTROLLER_MULTISIG_L1}`)
    .then((tx: ContractTransaction) => tx.wait());

  console.log("Transferring `ProxyAdmin` ownership to ControllerMultisigL1");
  await upgrades.admin.transferProxyAdminOwnership(`${process.env.CONTROLLER_MULTISIG_L1}`);

  // To change the admin via an arbitrary address, run the following:
  // await (await upgrades.admin.getInstance())
  //   .connect(controller)
  //   .transferOwnership(`${process.env.CONTROLLER_MULTISIG_L1}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.log(error);
    process.exit(1);
  });
