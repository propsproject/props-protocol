import { Contract } from "ethers";
import { ethers, upgrades } from "hardhat";


async function main() {
  const newProxyOwner:string = "0x0"; // use 0x0 to renounce ownership - irreversible
      
  await upgrades.admin.transferProxyAdminOwnership(newProxyOwner)  
  console.log(`proxy admin owner changed to: ${newProxyOwner}`);  
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
