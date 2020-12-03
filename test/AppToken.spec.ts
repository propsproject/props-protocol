import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { BigNumber } from "ethers";
import { Result } from "ethers/lib/utils";
import { ethers } from "hardhat";

import { AppToken } from "../typechain/AppToken";
import { AppTokenManager } from "../typechain/AppTokenManager";
import { createAppToken, deployContract, expandTo18Decimals } from './utils'

chai.use(solidity);
const { expect } = chai;

describe("AppToken", () => {  
  let appTokenLogic: AppToken;
  let appTokenManager: AppTokenManager;
  let signers: SignerWithAddress[];

  beforeEach(async () => {
    signers = await ethers.getSigners();

    appTokenLogic = await deployContract("AppToken", signers[0]);
    // console.log(`appTokenLogic.address=${appTokenLogic.address}`);

    appTokenManager = await deployContract("AppTokenManager", signers[0], appTokenLogic.address);
    // console.log(`appTokenManager.address=${appTokenManager.address}`);    
  });

  describe("new app token from factory", async () => {
    const testTokenName = "Embers";
    const testTokenSymbol = "EMBR";
    const testTokenSupply = BigNumber.from(1e9);

    it("app token deployed", async () => {  
      const tx = await appTokenManager.createAppToken(testTokenName, testTokenSymbol, testTokenSupply, signers[1].address, signers[2].address);
      const receipt = await tx.wait();

      const appTokenCreatedEvent = receipt.events?.find(
        ({ eventSignature }) => eventSignature === 'AppTokenCreated(address,string,uint256)'
      );
      expect(appTokenCreatedEvent).to.not.be.undefined;

      const eventArgs = appTokenCreatedEvent?.args;
      expect(eventArgs).to.not.be.undefined;

      const [, deployedTokenName, deployedTokenAmount] = eventArgs as Result;
      expect(deployedTokenName).to.eq(testTokenName);
      expect(deployedTokenAmount).to.eq(testTokenSupply);
    });

    it("deployed app token data is readable and correct", async () => {
      const appToken = await createAppToken(
        appTokenManager,
        testTokenName,
        testTokenSymbol,
        testTokenSupply,
        signers[0].address,
        signers[1].address
      ) as AppToken;
      expect(await appToken.name()).to.eq(testTokenName);      
      expect(await appToken.symbol()).to.eq(testTokenSymbol);
      expect(await appToken.totalSupply()).to.eq(expandTo18Decimals(testTokenSupply));
    });
  });  
});
