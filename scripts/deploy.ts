import { ethers } from "hardhat";

async function main() {
  const logicContractFactory = await ethers.getContractFactory("AppToken");

  // If we had constructor arguments, they would be passed into deploy()
  let logicContract = await logicContractFactory.deploy();

  // The address the Contract WILL have once mined
  console.log(`logicContract.address=${logicContract.address}`);

  // The transaction that was sent to the network to deploy the Contract
  console.log(`logicContract.deployTransaction.hash=${logicContract.deployTransaction.hash}`);

  // The contract is NOT deployed yet; we must wait until it is mined
  await logicContract.deployed();

  const appTokenFactory = await ethers.getContractFactory("AppTokenFactory"); 
  let appTokenFactoryContract = await appTokenFactory.deploy(logicContract.address);
  console.log(`appTokenFactoryContract.address=${appTokenFactoryContract.address}`);

  await appTokenFactoryContract.deployed();
  

}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
