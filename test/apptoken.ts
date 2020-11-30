import { ethers } from "hardhat";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { AppToken } from "../typechain/AppToken";
import { AppTokenManager } from "../typechain/AppTokenManager";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { BigNumber, ContractFactory, ContractTransaction } from "ethers";

const AppTokenAbi = require("../artifacts/contracts/AppToken.sol/AppToken.json");

chai.use(solidity);
const { expect } = chai;

describe("AppToken", () => {  
  let appTokenLogic:AppToken;
  let appTokenManager:AppTokenManager;
  let signers:SignerWithAddress[];

  beforeEach(async () => {
    // 1
    signers = await ethers.getSigners();

    // 2
    const logicContractFactory:ContractFactory = await ethers.getContractFactory(
      "AppToken",
      signers[0]
    );
    appTokenLogic = (await logicContractFactory.deploy()) as AppToken;
    await appTokenLogic.deployed();
    console.log(`appTokenLogic.address=${appTokenLogic.address}`);

    const appTokenManagerFactory:ContractFactory = await ethers.getContractFactory(
      "AppTokenManager",
      signers[0]
    );
    
    appTokenManager = (await appTokenManagerFactory.deploy(appTokenLogic.address)) as AppTokenManager
    await appTokenManager.deployed();
    console.log(`appTokenManager.address=${appTokenManager.address}`);    
  });

  // 4
  describe("new app token from factory", async () => {
    let deployedAppTokenContractAddress:string;
    const testTokenName:string = "Embers";
    const testTokenSymbol:string = "EMBR";
    const testTokenSupply:number = 1e9;
    it("app token deployed", async () => {  
      console.log(testTokenName, testTokenSymbol, testTokenSupply, signers[1].address, signers[2].address);
      const contractTx:ContractTransaction = await appTokenManager.createAppToken(testTokenName, testTokenSymbol, testTokenSupply, signers[1].address, signers[2].address);
      let triggerPromise = new Promise((resolve, reject) => {
        appTokenManager.on("AppTokenCreated(address,string,uint256)", (deployedTokenAddress, deployedTokenName, deployedTokenAmount, event) => { 
          //console.log(`deployedTokenAddress=${deployedTokenAddress}`);
          //console.log(`deployedTokenName=${deployedTokenName}`);
          // console.log(`deployedTokenAmount=${deployedTokenAmount}`);
          // console.log(`event=${JSON.stringify(event)}`);
          event.removeListener();          
          expect(deployedTokenName).to.eq(testTokenName);
          expect(deployedTokenAmount).to.eq(testTokenSupply.toString());
          deployedAppTokenContractAddress = deployedTokenAddress;
          resolve(true);                        
      });

      // After 30s, we throw a timeout error
      setTimeout(() => {
        reject(new Error('timeout while waiting for event'));
        }, 30000);
      });

      await triggerPromise;
      
    });
    it("app token data is readable and correct", async () => {      
      // (await new ethers.Contract(deployedAppTokenContractAddress, AppTokenAbi.abi, signers[1])) as AppToken;
      appTokenLogic.attach(deployedAppTokenContractAddress)
      
      const name: string = await appTokenLogic.name();
      const symbol: string = await appTokenLogic.symbol();
      const supply: BigNumber = await appTokenLogic.totalSupply();
      expect(name).to.eq(testTokenName);
      expect(symbol).to.eq(testTokenSymbol);
      expect(supply.toString()).to.eq(testTokenSupply.toString());
    });
  });  
});
