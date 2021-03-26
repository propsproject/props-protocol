import * as fs from "fs";
import { ethers } from "hardhat";

import type { PropsProtocol } from "../../typechain";

async function main() {
  // TODO: Add support for Gnosis Safe
  const controller = new ethers.Wallet(`${process.env.CONTROLLER_PRIVATE_KEY}`).connect(
    ethers.provider
  );

  const l2Addresses = JSON.parse(
    fs.readFileSync(`deployments/${process.env.L2_NETWORK}.json`).toString()
  ).slice(-1)[0];

  if (process.env.WHITELIST_APP) {
    console.log("Whitelisting app");
    const propsProtocol = (await ethers.getContractFactory("PropsProtocol", controller)).attach(
      l2Addresses["propsProtocol"]
    ) as PropsProtocol;
    await propsProtocol
      .connect(controller)
      .updateAppWhitelist(`${process.env.APP}`, true)
      .then((tx) => tx.wait());
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
