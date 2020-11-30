import { Contract } from "ethers";
import { ethers, upgrades } from "hardhat";

async function main() {
  
  const proxyAddress = process.argv[2]; // passed as argument to the script
  const logicContractFactory = await ethers.getContractFactory("AppToken");
  const res:Contract = await upgrades.upgradeProxy(proxyAddress, logicContractFactory);
  console.log(`upgrade done: ${res.address}`);  
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
