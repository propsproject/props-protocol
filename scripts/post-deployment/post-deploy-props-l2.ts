import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { ethers } from "hardhat";

// Matic contracts
const MATIC_CHILD_CHAIN_MANAGER = process.env.TESTNET
  ? "0xb5505a6d998549090530911180f38aC5130101c6"
  : "0xA6FA4fB5f76172d178d61B04b0ecd319C5d1C0aa";

// Accounts
let deployer: SignerWithAddress;

async function main() {
  if (!process.env.PROPS_TOKEN_L2_ADDRESS) {
    throw new Error("Missing configuration");
  }

  [deployer] = await ethers.getSigners();

  console.log("Permissioning Matic bridge as minter on `PropsTokenL2`");
  await deployer
    .sendTransaction({
      to: `${process.env.PROPS_TOKEN_L2_ADDRESS}`,
      data: new ethers.utils.Interface([
        "function addMinter(address)",
      ]).encodeFunctionData("addMinter", [MATIC_CHILD_CHAIN_MANAGER]),
    })
    .then((tx) => tx.wait());
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.log(error);
    process.exit(1);
  });
