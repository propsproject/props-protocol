import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { ethers } from "hardhat";

import { AppToken } from "../typechain/AppToken";
import { AppTokenManager } from "../typechain/AppTokenManager";
import {
  bn,
  createAppToken,
  deployContract,
  expandTo18Decimals,
  getEvent
} from "./utils";

chai.use(solidity);
const { expect } = chai;

describe("AppToken", () => {
  let signers: SignerWithAddress[];

  let appTokenManager: AppTokenManager;

  beforeEach(async () => {
    signers = await ethers.getSigners();

    const appTokenLogic: AppToken = await deployContract("AppToken", signers[0]);
    appTokenManager = await deployContract(
      "AppTokenManager",
      signers[0],
      appTokenLogic.address // _implementationContract
    ); 
  });

  describe("new app token from factory", async () => {
    const testTokenName = "Embers";
    const testTokenSymbol = "EMBR";
    const testTokenSupply = bn(1e9);

    it("deploying a new app token succeeds", async () => {
      // Deploy a new app token and check that the deployment succeeded
      const tx = await appTokenManager.createAppToken(
        testTokenName,      // name
        testTokenSymbol,    // symbol
        testTokenSupply,    // amount
        signers[1].address, // owner
        signers[2].address  // propsOwner
      );
      const [, deployedTokenName, deployedTokenAmount] = await getEvent(
        await tx.wait(),
        "AppTokenCreated(address,string,uint256)",
        "AppTokenManager"
      );
      expect(deployedTokenName).to.eq(testTokenName);
      expect(deployedTokenAmount).to.eq(testTokenSupply);
    });

    it("deployed app token data is readable and correct", async () => {
      // Deploy a new app token and check the deployed contract
      const appToken = await createAppToken(
        appTokenManager,
        testTokenName,      // name
        testTokenSymbol,    // symbol
        testTokenSupply,    // amount
        signers[0].address, // owner
        signers[1].address  // propsOwner
      ) as AppToken;
      expect(await appToken.name()).to.eq(testTokenName);      
      expect(await appToken.symbol()).to.eq(testTokenSymbol);
      expect(await appToken.totalSupply()).to.eq(expandTo18Decimals(testTokenSupply));
    });
  });  
});
