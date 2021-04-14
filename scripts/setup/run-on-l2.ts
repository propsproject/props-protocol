import * as fs from "fs";
import { ethers } from "hardhat";

import type { AppPointsL2, PropsProtocol, Staking } from "../../typechain";

async function main() {
  const l2Addresses = JSON.parse(
    fs.readFileSync(`deployments/${process.env.L2_NETWORK}.json`).toString()
  ).slice(-1)[0];

  if (process.env.WHITELIST_APP) {
    const controller = new ethers.Wallet(`${process.env.CONTROLLER_PRIVATE_KEY}`).connect(
      ethers.provider
    );

    console.log("Whitelisting app");
    const propsProtocol = (await ethers.getContractFactory("PropsProtocol", controller)).attach(
      l2Addresses["propsProtocol"]
    ) as PropsProtocol;
    await propsProtocol
      .connect(controller)
      .updateAppWhitelist(`${process.env.APP}`, true)
      .then((tx) => tx.wait());
  }

  if (process.env.MINT_ON_L2) {
    const owner = new ethers.Wallet(`${process.env.OWNER_PRIVATE_KEY}`).connect(ethers.provider);

    console.log("Minting app points on L2");
    const appPoints = (await ethers.getContractFactory("AppPointsL2", owner)).attach(
      `${process.env.APP_POINTS}`
    ) as AppPointsL2;
    await appPoints
      .connect(owner)
      .setMinter(owner.address)
      .then((tx) => tx.wait());
    await appPoints
      .connect(owner)
      .deposit(
        `${process.env.APP_POINTS_STAKING}`,
        new ethers.utils.AbiCoder().encode(
          ["uint256"],
          [ethers.utils.parseEther(`${process.env.AMOUNT}`)]
        )
      )
      .then((tx) => tx.wait());
  }

  if (process.env.DISTRIBUTE) {
    const owner = new ethers.Wallet(`${process.env.OWNER_PRIVATE_KEY}`).connect(ethers.provider);

    console.log("Distributing app points rewards");
    const appPointsStaking = (await ethers.getContractFactory("Staking", owner)).attach(
      `${process.env.APP_POINTS_STAKING}`
    ) as Staking;
    await appPointsStaking
      .connect(owner)
      .notifyRewardAmount(ethers.utils.parseEther(`${process.env.AMOUNT}`))
      .then((tx) => tx.wait());
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
