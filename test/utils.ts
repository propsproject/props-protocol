import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import * as ethUtil from "ethereumjs-util";
import {
  BigNumber,
  BigNumberish,
  Contract,
  ContractReceipt,
  utils
} from "ethers";
import { Result } from "ethers/lib/utils";
import { ethers } from "hardhat";

import AppTokenAbi from "../artifacts/contracts/AppToken.sol/AppToken.json";
import { AppToken } from "../typechain/AppToken";
import { AppTokenManager } from "../typechain/AppTokenManager";

// Specialized helpers

const PERMIT_TYPEHASH = utils.keccak256(
  utils.toUtf8Bytes("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)")
);

const getDomainSeparator = (
  name: string,
  tokenAddress: string
): string => {
  return utils.keccak256(
    utils.defaultAbiCoder.encode(
      ["bytes32", "bytes32", "bytes32", "uint256", "address"],
      [
        utils.keccak256(
          utils.toUtf8Bytes("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)")
        ),
        utils.keccak256(utils.toUtf8Bytes(name)),
        utils.keccak256(utils.toUtf8Bytes("1")),
        1,
        tokenAddress,
      ]
    )
  );
};

export const getApprovalDigest = async (
  token: Contract,
  approve: {
    owner: string,
    spender: string,
    value: BigNumber
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

// Deploys a new app token having the given attributes
export const createAppToken = async (
  appTokenManager: AppTokenManager,
  name: string,
  symbol: string,
  amount: BigNumber,
  owner: string,
  propsOwner: string
): Promise<AppToken> => {
  const tx = await appTokenManager.createAppToken(name, symbol, amount, owner, propsOwner);

  const [appTokenAddress, ] = await getEvent(
    await tx.wait(),
    "AppTokenCreated(address,string,uint256)",
    "AppTokenManager"
  );
  return new ethers.Contract(appTokenAddress, AppTokenAbi.abi, ethers.provider) as AppToken;
};

// Encode a governance action"s parameters
export const encodeParameters = (
  types: string[],
  values: any[]
) => {
  const abi = new ethers.utils.AbiCoder();
  return abi.encode(types, values);
};

// Generic helpers

// Deploys a given contract from an address
export const deployContract = async <T extends Contract>(
  name: string,
  deployer: SignerWithAddress,
  ...args: any[]
): Promise<T> => {
  const contractFactory = await ethers.getContractFactory(name, deployer);
  return await contractFactory.deploy(...args) as T;
};

// Retrieves an on-chain event"s parameters
export const getEvent = async (
  txReceipt: ContractReceipt,
  eventSignature: string,
  originatingContractName: string,
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
  return (log?.args) as Result;
};

// Returns the future address of a contract deployed by a specific address and correponding nonce
export const getFutureAddress = (
  deployerAddress: string,
  deployerNonce: number
): string => (
  ethUtil.bufferToHex(
    ethUtil.generateAddress(
      ethUtil.toBuffer(deployerAddress),
      ethUtil.toBuffer(deployerNonce)
    )
  )
);

// Mine a block at a given timestamp
export const mineBlock = async (timestamp?: BigNumberish) => (
  timestamp
    ? await ethers.provider.send("evm_mine", [bn(timestamp).toNumber()])
    : await ethers.provider.send("evm_mine", [])
);

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
export const expandTo18Decimals = (n: BigNumberish): BigNumber => (
  bn(n).mul(bn(10).pow(18))
);

// Simple wrapper for converting to BigNumber
export const bn = (n: BigNumberish): BigNumber => (
  BigNumber.from(n)
);

// Converts a given number of days to seconds
export const daysToTimestamp = (days: BigNumberish): BigNumber => (
  bn(days).mul(24).mul(3600)
);
