import * as fs from "fs";
import { ethers } from "hardhat";

import type { AppProxyFactoryL1 } from "../../typechain";

async function main() {
  const owner = new ethers.Wallet(`${process.env.OWNER_PRIVATE_KEY}`).connect(ethers.provider);

  const l1Addresses = JSON.parse(
    fs.readFileSync(`deployments/${process.env.L1_NETWORK}.json`).toString()
  ).slice(-1)[0];

  if (process.env.DEPLOY_APP) {
    console.log("Deploying app");
    const appProxyFactory = (await ethers.getContractFactory("AppProxyFactoryL1", owner)).attach(
      l1Addresses["appProxyFactory"]
    ) as AppProxyFactoryL1;
    await appProxyFactory
      .connect(owner)
      .deployApp(
        `${process.env.NAME}`,
        `${process.env.SYMBOL}`,
        ethers.utils.parseEther(`${process.env.AMOUNT}`),
        owner.address,
        ethers.utils.parseEther(`${process.env.DAILY_REWARDS_EMISSION}`).div(100)
      )
      .then((tx) => tx.wait());
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
