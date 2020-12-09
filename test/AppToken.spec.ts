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
  let deployer: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;

  let appTokenManager: AppTokenManager;

  beforeEach(async () => {
    [deployer, alice, bob, ] = await ethers.getSigners();

    const appTokenLogic = await deployContract<AppToken>("AppToken", deployer);
    appTokenManager = await deployContract(
      "AppTokenManager",
      deployer,
      appTokenLogic.address // _implementationContract
    ); 
  });

  describe("new app token from factory", async () => {
    const TEST_TOKEN_NAME = "Ember";
    const TEST_TOKEN_SYMBOL = "EMBR";
    const TEST_TOKEN_SUPPLY = bn(1e9);

    it("deploying a new app token succeeds", async () => {
      // Deploy a new app token and check that the deployment succeeded
      const tx = await appTokenManager.createAppToken(
        TEST_TOKEN_NAME,   // name
        TEST_TOKEN_SYMBOL, // symbol
        TEST_TOKEN_SUPPLY, // amount
        alice.address,     // owner
        bob.address        // propsOwner
      );
      const [, deployedTokenName, deployedTokenAmount] = await getEvent(
        await tx.wait(),
        "AppTokenCreated(address,string,uint256)",
        "AppTokenManager"
      );
      expect(deployedTokenName).to.eq(TEST_TOKEN_NAME);
      expect(deployedTokenAmount).to.eq(TEST_TOKEN_SUPPLY);
    });

    it("deployed app token data is readable and correct", async () => {
      // Deploy a new app token and check the deployed contract
      const appToken = await createAppToken(
        appTokenManager,
        TEST_TOKEN_NAME,   // name
        TEST_TOKEN_SYMBOL, // symbol
        TEST_TOKEN_SUPPLY, // amount
        alice.address,     // owner
        bob.address        // propsOwner
      );
      expect(await appToken.name()).to.eq(TEST_TOKEN_NAME);      
      expect(await appToken.symbol()).to.eq(TEST_TOKEN_SYMBOL);
      expect(await appToken.totalSupply()).to.eq(expandTo18Decimals(TEST_TOKEN_SUPPLY));
    });
  });  
});
