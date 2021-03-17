import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import * as fs from "fs";
import { ethers, upgrades } from "hardhat";

import type { AppProxyFactoryL1 } from "../../typechain";

// Matic contracts
const MATIC_MINTABLE_ERC20_PREDICATE = process.env.TESTNET
  ? "0x37c3bfC05d5ebF9EBb3FF80ce0bd0133Bf221BC8"
  : "0x9923263fA127b3d1484cFD649df8f1831c2A74e4";

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
    .then((tx) => tx.wait());

  console.log("Transferring protocol `ProxyAdmin` ownership to ControllerMultisigL1");
  await upgrades.admin.transferProxyAdminOwnership(`${process.env.CONTROLLER_MULTISIG_L1}`);

  // We don't have any permissions to change anything on the L1 Props token,
  // as that resides as a separate deployment and is controlled by accounts
  // we don't have access to in here. However, what we can do is prepare any
  // calls that are to be performed by the controlling accounts for transferring
  // any ownership roles on the L1 Props token to accounts that we control.

  console.log("Permissioning Matic bridge as minter on `PropsTokenL1`");
  console.log("To be sent by controller to `PropsTokenL1`:");
  console.log(`addMinter(${MATIC_MINTABLE_ERC20_PREDICATE})`);
  console.log(
    new ethers.utils.Interface(["function addMinter(address)"]).encodeFunctionData("addMinter", [
      MATIC_MINTABLE_ERC20_PREDICATE,
    ])
  );

  // await deployer
  //   .sendTransaction({
  //     to: process.env.PROPS_TOKEN_L1,
  //     data: "0x983b2d5600000000000000000000000037c3bfc05d5ebf9ebb3ff80ce0bd0133bf221bc8",
  //   })
  //   .then((tx) => tx.wait());

  console.log("Transferring `PropsTokenL1` control to ControllerMultisigL1");
  console.log("To be sent by controller to `PropsTokenL1`:");
  console.log(`updateController(${process.env.CONTROLLER_MULTISIG_L1})`);
  console.log(
    new ethers.utils.Interface([
      "function updateController(address)",
    ]).encodeFunctionData("updateController", [`${process.env.CONTROLLER_MULTISIG_L1}`])
  );

  // await deployer
  //   .sendTransaction({
  //     to: process.env.PROPS_TOKEN_L1,
  //     data: "0x06cb5b6600000000000000000000000003ea6120b2b3826e6a3206864d682d15fa102a50",
  //   })
  //   .then((tx) => tx.wait());

  console.log("Transferring `PropsTokenL1` proxy administration to protocol `ProxyAdmin`");
  console.log(
    "To be sent by `PropsTokenL1`'s `ProxyAdmin` owner to `PropsTokenL1`'s `ProxyAdmin`:"
  );
  console.log(
    `changeProxyAdmin(${process.env.PROPS_TOKEN_L1}, ${
      (await upgrades.admin.getInstance()).address
    })`
  );
  console.log(
    new ethers.utils.Interface([
      "function changeProxyAdmin(address, address)",
    ]).encodeFunctionData("changeProxyAdmin", [
      process.env.PROPS_TOKEN_L1,
      (await upgrades.admin.getInstance()).address,
    ])
  );

  // await deployer
  //   .sendTransaction({
  //     to: "0xB9D83d05A831728F24E92584e0eceC2aA73D0DBF",
  //     data:
  //       "0x7eff275e000000000000000000000000508914aa697c450e76d6c04bc92d58d094e2b1530000000000000000000000002a96c9c5ec2d4ed8c8b09554cb5ac583b39b722a",
  //   })
  //   .then((tx) => tx.wait());
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.log(error);
    process.exit(1);
  });
