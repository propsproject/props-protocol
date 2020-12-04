import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { BigNumber, Contract, providers, utils } from 'ethers';
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

export async function deployContract<T extends Contract>(
  name: string,
  signer: SignerWithAddress,
  ...args: any[]
): Promise<T> {
  const contractFactory = await ethers.getContractFactory(name, signer);
  return await contractFactory.deploy(...args) as T;
}

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

export async function mineBlock(provider: providers.JsonRpcProvider, timestamp: BigNumber): Promise<void> {
  return provider.send('evm_mine', [timestamp.toNumber()]);
}

export function expandTo18Decimals(n: number | BigNumber): BigNumber {
  return BigNumber.from(n).mul(BigNumber.from(10).pow(18));
}

export function daysToTimestamp(days: number | BigNumber): BigNumber {
  return BigNumber.from(days).mul(24 * 3600);
}
