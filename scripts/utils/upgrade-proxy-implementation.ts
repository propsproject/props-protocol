import { ethers, upgrades } from "hardhat";

async function main() {
  const proxyAddress = process.env.PROXY_ADDRESS;
  if (!proxyAddress) {
    throw new Error(`Missing PROXY_ADDRESS - the proxy contract to get upgraded`);
  }

  const contractName = process.env.CONTRACT_NAME;
  if (!contractName) {
    throw new Error(`Missing CONTRACT_NAME - the name for the proxy's implementation contract`);
  }

  console.log("Upgrading proxy implementation...");
  const factory = await ethers.getContractFactory(contractName);
  await upgrades.upgradeProxy(proxyAddress, factory);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
