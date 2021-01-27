import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import {
  BigNumber,
  BigNumberish,
  Contract,
  ContractFactory,
  ContractReceipt,
  ContractTransaction,
  utils,
} from "ethers";
import { Result } from "ethers/lib/utils";
import * as fs from "fs";
import * as glob from "glob";
import { ethers, upgrades } from "hardhat";

// Permit typehash for ERC20 permit functionality
const PERMIT_TYPEHASH = utils.keccak256(
  utils.toUtf8Bytes(
    "Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"
  )
);

// Utility for getting the domain separator for ERC20 permit functionality
const getDomainSeparator = (name: string, tokenAddress: string): string => {
  return utils.keccak256(
    utils.defaultAbiCoder.encode(
      ["bytes32", "bytes32", "bytes32", "uint256", "address"],
      [
        utils.keccak256(
          utils.toUtf8Bytes(
            "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
          )
        ),
        utils.keccak256(utils.toUtf8Bytes(name)),
        utils.keccak256(utils.toUtf8Bytes("1")),
        ethers.provider.network.chainId,
        tokenAddress,
      ]
    )
  );
};

// Get approval digest for ERC20 permit functionality
export const getApprovalDigest = async (
  token: Contract,
  approve: {
    owner: string;
    spender: string;
    value: BigNumber;
  },
  nonce: BigNumber,
  deadline: BigNumber
): Promise<string> => {
  const name = await token.name();
  const DOMAIN_SEPARATOR = getDomainSeparator(name, token.address);
  return utils.keccak256(
    utils.solidityPack(
      ["bytes1", "bytes1", "bytes32", "bytes32"],
      [
        "0x19",
        "0x01",
        DOMAIN_SEPARATOR,
        utils.keccak256(
          utils.defaultAbiCoder.encode(
            ["bytes32", "address", "address", "uint256", "uint256", "uint256"],
            [PERMIT_TYPEHASH, approve.owner, approve.spender, approve.value, nonce, deadline]
          )
        ),
      ]
    )
  );
};

// Generates the public key from a given private key
export const getPublicKey = (privateKey: string): string => new ethers.Wallet(privateKey).address;

// Encode a governance action's parameters
export const encodeParameters = (types: string[], values: any[]) => {
  const abi = new ethers.utils.AbiCoder();
  return abi.encode(types, values);
};

// Get the contract factory for the given contract
export const getContractFactory = (name: string, signer?: SignerWithAddress): ContractFactory => {
  // For Optimism, use the .ovm artifacts
  if (process.env.OVM) {
    name = `${name}.ovm`;
  }

  const artifacts = glob.sync(`./artifacts/contracts/**/${name}.json`);
  const solidityOutput = fs.readFileSync(artifacts[0]).toString();
  return ContractFactory.fromSolidity(solidityOutput, signer);
};

// Deploys a given contract from an address
export const deployContract = async <T extends Contract>(
  name: string,
  deployer: SignerWithAddress,
  ...args: any[]
): Promise<T> => {
  const contractFactory = getContractFactory(name, deployer);
  const contractInstance = await contractFactory.deploy(...args);
  return (await contractInstance.deployed()) as T;
};

export const deployContractUpgradeable = async <T extends Contract>(
  name: string,
  deployer: SignerWithAddress,
  ...args: any[]
): Promise<T> => {
  const contractFactory = getContractFactory(name, deployer);
  const contractInstance = await upgrades.deployProxy(contractFactory, ...args, {
    // TODO Manually check for storage incompatibilities (the Checkpoint struct in SPropsToken)
    unsafeAllowCustomTypes: true,
  });
  return (await contractInstance.deployed()) as T;
};

// Retrieves an on-chain event"s parameters
export const getEvent = async (
  txReceipt: ContractReceipt,
  eventSignature: string,
  originatingContractName: string
): Promise<Result> => {
  const contractAbi = getContractFactory(originatingContractName).interface;

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
