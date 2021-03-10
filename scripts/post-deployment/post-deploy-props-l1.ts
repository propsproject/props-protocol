import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { ethers } from "hardhat";

// Matic contracts
const MATIC_MINTABLE_ERC20_PREDICATE = process.env.TESTNET
  ? "0x37c3bfC05d5ebF9EBb3FF80ce0bd0133Bf221BC8"
  : "0x9923263fA127b3d1484cFD649df8f1831c2A74e4";

// Accounts
let deployer: SignerWithAddress;

async function main() {
  if (
    !process.env.PROPS_TOKEN_L1_ADDRESS ||
    !process.env.PROPS_TOKEN_L1_PROXY_ADMIN_ADDRESS ||
    !process.env.PROTOCOL_L1_PROXY_ADMIN_ADDRESS
  ) {
    throw new Error("Missing configuration");
  }

  [deployer] = await ethers.getSigners();

  if (process.env.TESTNET) {
    // If we are on testnet, we can assume the L1 version of the Props token
    // was deployed via the current `deployer` address and is fully controlled
    // by the same address (it is both the controller of the L1 Props token and
    // the owner of the ProxyAdmin associated with the L1 Props token).

    console.log("Permissioning Matic bridge as minter on `PropsTokenL1`");
    await deployer
      .sendTransaction({
        to: `${process.env.PROPS_TOKEN_L1_ADDRESS}`,
        data: new ethers.utils.Interface([
          "function addMinter(address)",
        ]).encodeFunctionData("addMinter", [MATIC_MINTABLE_ERC20_PREDICATE]),
      })
      .then((tx) => tx.wait());

    console.log("Transferring `PropsTokenL1` control to ControllerMultisigL1");
    await deployer
      .sendTransaction({
        to: `${process.env.PROPS_TOKEN_L1_ADDRESS}`,
        data: new ethers.utils.Interface([
          "function updateController(address)",
        ]).encodeFunctionData("updateController", [`${process.env.CONTROLLER_MULTISIG_L1}`]),
      })
      .then((tx) => tx.wait());

    console.log("Transferring `ProxyAdmin` ownership to ControllerMultisigL1");
    await deployer
      .sendTransaction({
        to: `${process.env.PROPS_TOKEN_L1_PROXY_ADMIN_ADDRESS}`,
        data: new ethers.utils.Interface([
          "function changeProxyAdmin(address, address)",
        ]).encodeFunctionData("changeProxyAdmin", [
          `${process.env.PROPS_TOKEN_L1_ADDRESS}`,
          `${process.env.PROTOCOL_L1_PROXY_ADMIN_ADDRESS}`,
        ]),
      })
      .then((tx) => tx.wait());
  } else {
    // However, on mainnet, the L1 Props token is controlled by multisigs,
    // so all we can do is generate the calldata that is to be relayed
    // through the controlling multisigs.

    console.log("Permissioning Matic bridge as minter on `PropsTokenL1`");
    console.log(`Calldata to be sent to ${process.env.PROPS_TOKEN_L1_ADDRESS}:`);
    console.log(
      new ethers.utils.Interface(["function addMinter(address)"]).encodeFunctionData("addMinter", [
        MATIC_MINTABLE_ERC20_PREDICATE,
      ])
    );

    console.log("Transferring `PropsTokenL1` control to ControllerMultisigL1");
    console.log(`Calldata to be sent to ${process.env.PROPS_TOKEN_L1_ADDRESS}:`);
    console.log(
      new ethers.utils.Interface([
        "function updateController(address)",
      ]).encodeFunctionData("updateController", [`${process.env.CONTROLLER_MULTISIG_L1}`])
    );

    console.log("Transferring `ProxyAdmin` ownership to ControllerMultisigL1");
    console.log(`Calldata to be sent to ${process.env.PROPS_TOKEN_L1_PROXY_ADMIN_ADDRESS}:`);
    console.log(
      new ethers.utils.Interface([
        "function changeProxyAdmin(address, address)",
      ]).encodeFunctionData("changeProxyAdmin", [
        `${process.env.PROPS_TOKEN_L1_ADDRESS}`,
        `${process.env.PROTOCOL_L1_PROXY_ADMIN_ADDRESS}`,
      ])
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.log(error);
    process.exit(1);
  });
