import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { BigNumber } from "ethers";
import { ethers } from "hardhat";

import type {
  AppToken,
  AppTokenProxyFactory,
  PropsController,
  Staking,
  TestPropsToken,
} from "../typechain";
import {
  bn,
  deployContract,
  deployContractUpgradeable,
  expandTo18Decimals,
  getEvent,
} from "../utils";

chai.use(solidity);
const { expect } = chai;

describe("AppTokenProxyFactory", () => {
  let propsTreasury: SignerWithAddress;
  let appTokenOwner: SignerWithAddress;

  let propsToken: TestPropsToken;
  let appTokenProxyFactory: AppTokenProxyFactory;
  let propsController: PropsController;

  const PROPS_TOKEN_AMOUNT = expandTo18Decimals(100000);

  const APP_TOKEN_NAME = "AppToken";
  const APP_TOKEN_SYMBOL = "AppToken";
  const APP_TOKEN_AMOUNT = expandTo18Decimals(100000);

  // Corresponds to 0.0003658 - taken from old Props rewards formula
  // Distributes 12.5% of the remaining rewards pool each year
  const DAILY_REWARDS_EMISSION = bn(3658).mul(1e11);

  const deployAppToken = async (
    rewardsDistributedPercentage: BigNumber = bn(0)
  ): Promise<[AppToken, Staking]> => {
    const tx = await appTokenProxyFactory
      .connect(appTokenOwner)
      .deployAppToken(
        APP_TOKEN_NAME,
        APP_TOKEN_SYMBOL,
        APP_TOKEN_AMOUNT,
        appTokenOwner.address,
        DAILY_REWARDS_EMISSION,
        rewardsDistributedPercentage
      );
    const [appTokenAddress, appTokenStakingAddress] = await getEvent(
      await tx.wait(),
      "AppTokenDeployed(address,address,string,string,address)",
      "AppTokenProxyFactory"
    );

    await propsController.connect(propsTreasury).whitelistAppToken(appTokenAddress);

    return [
      (await ethers.getContractFactory("AppToken")).attach(appTokenAddress) as AppToken,
      (await ethers.getContractFactory("Staking")).attach(appTokenStakingAddress) as Staking,
    ];
  };

  beforeEach(async () => {
    [propsTreasury, appTokenOwner] = await ethers.getSigners();

    propsToken = await deployContractUpgradeable("TestPropsToken", propsTreasury, [
      PROPS_TOKEN_AMOUNT,
    ]);

    propsController = await deployContractUpgradeable("PropsController", propsTreasury, [
      propsTreasury.address,
      propsTreasury.address,
      propsToken.address,
    ]);

    const rPropsToken = await deployContractUpgradeable("RPropsToken", propsTreasury, [
      propsController.address,
      propsToken.address,
    ]);

    const sPropsToken = await deployContractUpgradeable("SPropsToken", propsTreasury, [
      propsController.address,
    ]);

    const sPropsAppStaking = await deployContractUpgradeable("Staking", propsTreasury, [
      propsController.address,
      rPropsToken.address,
      rPropsToken.address,
      propsController.address,
      DAILY_REWARDS_EMISSION,
    ]);

    const sPropsUserStaking = await deployContractUpgradeable("Staking", propsTreasury, [
      propsController.address,
      rPropsToken.address,
      rPropsToken.address,
      propsController.address,
      DAILY_REWARDS_EMISSION,
    ]);

    const appTokenLogic = await deployContract<AppToken>("AppToken", propsTreasury);
    const appTokenStakingLogic = await deployContract<Staking>("Staking", propsTreasury);

    appTokenProxyFactory = await deployContractUpgradeable("AppTokenProxyFactory", propsTreasury, [
      propsTreasury.address,
      propsController.address,
      propsTreasury.address,
      propsToken.address,
      appTokenLogic.address,
      appTokenStakingLogic.address,
    ]);

    // The rProps token contract is allowed to mint new Props
    await propsToken.connect(propsTreasury).setMinter(rPropsToken.address);

    // Initialize all needed fields on the controller
    await propsController
      .connect(propsTreasury)
      .setAppTokenProxyFactory(appTokenProxyFactory.address);
    await propsController.connect(propsTreasury).setRPropsToken(rPropsToken.address);
    await propsController.connect(propsTreasury).setSPropsToken(sPropsToken.address);
    await propsController.connect(propsTreasury).setSPropsAppStaking(sPropsAppStaking.address);
    await propsController.connect(propsTreasury).setSPropsUserStaking(sPropsUserStaking.address);

    // Distribute the rProps rewards to the sProps staking contracts
    await propsController.connect(propsTreasury).distributePropsRewards(bn(800000), bn(200000));
  });

  it("successfully deploys a new app token", async () => {
    const rewardsDistributedPercentage = bn(10000);
    const [appToken, appTokenStaking] = await deployAppToken(rewardsDistributedPercentage);

    // Check that the staking contract was correctly associated with the app token
    expect(await propsController.appTokenToStaking(appToken.address)).to.eq(
      appTokenStaking.address
    );

    // Check basic token information
    expect(await appToken.name()).to.eq(APP_TOKEN_NAME);
    expect(await appToken.symbol()).to.eq(APP_TOKEN_SYMBOL);
    expect(await appToken.totalSupply()).to.eq(APP_TOKEN_AMOUNT);

    // Check that the initial supply was properly distributed (5% goes to the Props treasury)
    expect(await appToken.balanceOf(propsTreasury.address)).to.eq(APP_TOKEN_AMOUNT.div(20));

    const ownerAmount = APP_TOKEN_AMOUNT.sub(APP_TOKEN_AMOUNT.div(20));
    expect(await appToken.balanceOf(appTokenOwner.address)).to.eq(
      ownerAmount.sub(ownerAmount.mul(rewardsDistributedPercentage).div(1000000))
    );

    // Check basic staking information
    expect(await appTokenStaking.stakingToken()).to.eq(propsToken.address);
    expect(await appTokenStaking.rewardsToken()).to.eq(appToken.address);

    // Check the initial rewards were properly distributed on deployment
    expect(await appTokenStaking.rewardRate()).to.not.eq(bn(0));
    expect(await appToken.balanceOf(appTokenStaking.address)).to.eq(
      ownerAmount.mul(rewardsDistributedPercentage).div(1000000)
    );
  });

  it("proper permissioning", async () => {
    const mockAddress = propsTreasury.address;

    // Only the owner is allowed to change the logic contracts
    await expect(
      appTokenProxyFactory.connect(appTokenOwner).setAppTokenLogic(mockAddress)
    ).to.be.revertedWith("Ownable: caller is not the owner");
    await expect(
      appTokenProxyFactory.connect(appTokenOwner).setAppTokenStakingLogic(mockAddress)
    ).to.be.revertedWith("Ownable: caller is not the owner");

    await appTokenProxyFactory.connect(propsTreasury).setAppTokenLogic(mockAddress);
    await appTokenProxyFactory.connect(propsTreasury).setAppTokenStakingLogic(mockAddress);
  });
});
