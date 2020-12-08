import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import {
  BigNumber,
  Contract,
  ContractReceipt,
  providers,
  utils
} from 'ethers';
import { Interface, Result } from 'ethers/lib/utils';
import { ethers } from 'hardhat';

import AppTokenAbi from '../artifacts/contracts/AppToken.sol/AppToken.json';
import { AppToken } from '../typechain/AppToken';
import { AppTokenManager } from '../typechain/AppTokenManager';

const PERMIT_TYPEHASH = utils.keccak256(
  utils.toUtf8Bytes('Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)')
);

function getDomainSeparator(name: string, tokenAddress: string) {
  return utils.keccak256(
    utils.defaultAbiCoder.encode(
      ['bytes32', 'bytes32', 'bytes32', 'uint256', 'address'],
      [
        utils.keccak256(
          utils.toUtf8Bytes('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)')
        ),
        utils.keccak256(utils.toUtf8Bytes(name)),
        utils.keccak256(utils.toUtf8Bytes('1')),
        1,
        tokenAddress,
      ]
    )
  );
}

export async function getApprovalDigest(
  token: Contract,
  approve: {
    owner: string,
    spender: string,
    value: BigNumber
  },
  nonce: BigNumber,
  deadline: BigNumber
): Promise<string> {
  const name = await token.name();
  const DOMAIN_SEPARATOR = getDomainSeparator(name, token.address);
  return utils.keccak256(
    utils.solidityPack(
      ['bytes1', 'bytes1', 'bytes32', 'bytes32'],
      [
        '0x19',
        '0x01',
        DOMAIN_SEPARATOR,
        utils.keccak256(
          utils.defaultAbiCoder.encode(
            ['bytes32', 'address', 'address', 'uint256', 'uint256', 'uint256'],
            [PERMIT_TYPEHASH, approve.owner, approve.spender, approve.value, nonce, deadline]
          )
        ),
      ]
    )
  );
}

// Generic helpers

export async function deployContract<T extends Contract>(
  name: string,
  signer: SignerWithAddress,
  ...args: any[]
): Promise<T> {
  const contractFactory = await ethers.getContractFactory(name, signer);
  return await contractFactory.deploy(...args) as T;
}

// Get the arguments of an event that was directly triggered by the calling function
export function getDirectEvent(receipt: ContractReceipt, signature: string): Result {
  const event = receipt.events?.find(({ eventSignature }) => eventSignature === signature);
  const eventArgs = event?.args;
  return eventArgs as Result;
}

// Get the arguments of an event that was indirectly triggered by the calling function (e.g. in sub-calls)
export function getIndirectEvent(
  receipt: ContractReceipt,
  eventSignature: string,
  abiInterface: Interface,
): Result {
  let parsedEvents: utils.LogDescription[] = [];
  try {
    receipt.logs.forEach(log => parsedEvents.push(abiInterface.parseLog(log)));
  } catch {
    // Ignore any errors, we should have already processed all the needed events
  }

  const event = parsedEvents.find(({ signature }) => signature === eventSignature);
  const eventArgs = event?.args;
  return eventArgs as Result;
}

export async function mineBlock(provider: providers.JsonRpcProvider, timestamp: BigNumber): Promise<void> {
  return provider.send('evm_mine', [timestamp.toNumber()]);
}

export function expandTo18Decimals(n: number | BigNumber): BigNumber {
  return BigNumber.from(n).mul(BigNumber.from(10).pow(18));
}

export function bn(n: number): BigNumber {
  return BigNumber.from(n);
}

export function daysToTimestamp(days: number | BigNumber): BigNumber {
  return BigNumber.from(days).mul(24 * 3600);
}

// Specialized helpers

export async function createAppToken(
  appTokenManager: AppTokenManager,
  name: string,
  symbol: string,
  amount: BigNumber,
  owner: string,
  propsOwner: string
): Promise<AppToken | undefined> {
  const tx = await appTokenManager.createAppToken(name, symbol, amount, owner, propsOwner);
  const receipt = await tx.wait();
  const appTokenCreatedEvent = receipt.events?.find(
    ({ eventSignature }) => eventSignature === 'AppTokenCreated(address,string,uint256)'
  );
  const eventArgs = appTokenCreatedEvent?.args;
  return eventArgs
    ? new ethers.Contract(eventArgs[0] as string, AppTokenAbi.abi, ethers.provider) as AppToken
    : undefined;
}
