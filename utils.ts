import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import {
  BigNumber,
  BigNumberish,
  Contract,
  ContractReceipt,
  ContractTransaction,
  utils,
} from "ethers";
import { Result } from "ethers/lib/utils";
import { ethers, upgrades } from "hardhat";

import accounts from "./test-accounts";

// Gets the private key of a given test account address
export const getPrivateKey = (address: string): Buffer =>
  Buffer.from(
    accounts
      .find(({ privateKey }) => new ethers.Wallet(privateKey).address === address)!
      .privateKey.slice(2),
    "hex"
  );

// Encode a governance action's parameters
export const encodeParameters = (types: string[], values: any[]) => {
  const abi = new ethers.utils.AbiCoder();
  return abi.encode(types, values);
};

// Deploys a given contract from an address
export const deployContract = async <T extends Contract>(
  name: string,
  deployer: SignerWithAddress,
  ...args: any[]
): Promise<T> => {
  const contractFactory = await ethers.getContractFactory(name, deployer);
  const contractInstance = await contractFactory.deploy(...args);
  return (await contractInstance.deployed()) as T;
};

export const deployContractUpgradeable = async <T extends Contract>(
  name: string,
  deployer: SignerWithAddress,
  ...args: any[]
): Promise<T> => {
  const contractFactory = await ethers.getContractFactory(name, deployer);
  const contractInstance = await upgrades.deployProxy(contractFactory, [...args]);
  return (await contractInstance.deployed()) as T;
};

// Retrieves an on-chain event"s parameters
export const getEvent = async (
  txReceipt: ContractReceipt,
  eventSignature: string,
  originatingContractName: string
): Promise<Result> => {
  const contractAbi = (await ethers.getContractFactory(originatingContractName)).interface;

  let parsedLogs: utils.LogDescription[] = [];
  txReceipt.logs.forEach((log) => {
    try {
      parsedLogs.push(contractAbi.parseLog(log));
    } catch {
      // Ignore any errors, the log entry might just belong to
      // a different contract than the one we have the ABI of
    }
  });

  // Assume the event is present
  const log = parsedLogs.find(({ signature }) => signature === eventSignature);
  return log?.args as Result;
};

export const getTxTimestamp = async (tx: ContractTransaction): Promise<BigNumber> =>
  bn(await ethers.provider.getBlock(tx.blockNumber as number).then((block) => block.timestamp));

// Mine a block at a given timestamp
export const mineBlock = async (timestamp?: BigNumberish) =>
  timestamp
    ? await ethers.provider.send("evm_mine", [bn(timestamp).toNumber()])
    : await ethers.provider.send("evm_mine", []);

// Mine a given number of blocks
export const mineBlocks = async (numBlocks: number) => {
  for (let i = 0; i < numBlocks; i++) {
    await mineBlock();
  }
};

// Retrieves the current timestamp on the blockchain
export const now = async (): Promise<BigNumber> => {
  const latestBlock = await ethers.provider.getBlock("latest");
  return bn(latestBlock.timestamp);
};

// Pads a given number with 18 zeros
export const expandTo18Decimals = (n: BigNumberish): BigNumber => bn(n).mul(bn(10).pow(18));

// Simple wrapper for converting to BigNumber
export const bn = (n: BigNumberish): BigNumber => BigNumber.from(n);

// Converts a given number of days to seconds
export const daysToTimestamp = (days: BigNumberish): BigNumber => bn(days).mul(24).mul(3600);
