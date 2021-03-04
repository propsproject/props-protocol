import { EventSignature, buildPayloadForExit, encodePayload } from "@tomfrench/matic-proofs";
import { ethers } from "hardhat";

const l1Provider = new ethers.providers.JsonRpcProvider(
  process.env.TESTNET
    ? `https://goerli.infura.io/v3/${process.env.INFURA_PROJECT_ID}`
    : `https://mainnet.infura.io/v3/${process.env.INFURA_PROJECT_ID}`
);
const l2Provider = new ethers.providers.JsonRpcProvider(
  process.env.TESTNET ? "https://rpc-mumbai.matic.today" : "https://rpc-mainnet.matic.network"
);

const MATIC_ROOT_CHAIN_MANAGER_ADDRESS = process.env.TESTNET
  ? "0xBbD7cBFA79faee899Eaf900F13C9065bF03B1A74"
  : "0xA0c68C638235ee32657e8f720a23ceC1bFc77C77";

async function main() {
  if (!process.env.L2_TX_HASH) {
    throw new Error("No L2 transaction provided");
  }

  const l2TxHash = process.env.L2_TX_HASH as string;

  const maticRootChain = await ethers.getContractAt(
    ["function checkpointManagerAddress() returns (address)"],
    MATIC_ROOT_CHAIN_MANAGER_ADDRESS
  );
  const checkpointManagerAddress = await maticRootChain
    .connect(l1Provider)
    .checkpointManagerAddress();

  const checkpointManager = await ethers.getContractAt(
    ["function getLastChildBlock() returns (uint256)"],
    checkpointManagerAddress
  );
  const lastCheckpointedBlock: number = await checkpointManager
    .connect(l1Provider)
    .getLastChildBlock();

  const txReceipt = await l2Provider.getTransactionReceipt(l2TxHash);
  if (!txReceipt) {
    throw new Error("Could not fetch transaction");
  }

  if (txReceipt.blockNumber > lastCheckpointedBlock) {
    throw new Error("Transaction not yet checkpointed");
  } else {
    const inclusionProof = encodePayload(
      await buildPayloadForExit(
        l1Provider,
        l2Provider,
        MATIC_ROOT_CHAIN_MANAGER_ADDRESS,
        process.env.L2_TX_HASH as string,
        EventSignature.SendMessage
      )
    );

    console.log("Here is the generated inclusion proof:");
    console.log(inclusionProof);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
