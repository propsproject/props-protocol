import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import chai from "chai";
import * as ethUtil from "ethereumjs-util";
import { solidity } from "ethereum-waffle";
import { ethers } from "hardhat";

import accounts from "../test-accounts";
import type { AppToken, PropsController, RPropsToken, Staking, TestPropsToken } from "../typechain";
import {
  bn,
  daysToTimestamp,
  deployContract,
  deployContractUpgradeable,
  expandTo18Decimals,
  getApprovalDigest,
  getEvent,
  getPublicKey,
  getTxTimestamp,
  mineBlock,
  now,
} from "../utils";

chai.use(solidity);
const { expect } = chai;

describe("PropsController", () => {
  let propsTreasury: SignerWithAddress;
  let appTokenOwner: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;

  let propsToken: TestPropsToken;
  let rPropsToken: RPropsToken;
  let sPropsAppStaking: Staking;
  let sPropsUserStaking: Staking;
  let propsController: PropsController;

  const PROPS_TOKEN_AMOUNT = expandTo18Decimals(100000);

  const APP_TOKEN_NAME = "AppToken";
  const APP_TOKEN_SYMBOL = "AppToken";
  const APP_TOKEN_AMOUNT = expandTo18Decimals(100000);

  // Corresponds to 0.0003658 - taken from old Props rewards formula
  // Distributes 12.5% of the remaining rewards pool each year
  const DAILY_REWARDS_EMISSION = bn(3658).mul(1e11);

  const deployAppToken = async (): Promise<[AppToken, Staking]> => {
    const tx = await propsController
      .connect(appTokenOwner)
      .deployAppToken(
        APP_TOKEN_NAME,
        APP_TOKEN_SYMBOL,
        APP_TOKEN_AMOUNT,
        appTokenOwner.address,
        DAILY_REWARDS_EMISSION
      );
    const [appTokenAddress, appTokenStakingAddress] = await getEvent(
      await tx.wait(),
      "AppTokenDeployed(address,address,string,uint256)",
      "PropsController"
    );

    await propsController.connect(propsTreasury).whitelistAppToken(appTokenAddress);

    return [
      (await ethers.getContractFactory("AppToken")).attach(appTokenAddress) as AppToken,
      (await ethers.getContractFactory("Staking")).attach(appTokenStakingAddress) as Staking,
    ];
  };

  beforeEach(async () => {
    [propsTreasury, appTokenOwner, alice, bob] = await ethers.getSigners();

    const appTokenLogic = await deployContract<AppToken>("AppToken", propsTreasury);
    const appTokenStakingLogic = await deployContract<Staking>("Staking", propsTreasury);

    propsToken = await deployContractUpgradeable("TestPropsToken", propsTreasury, [
      PROPS_TOKEN_AMOUNT,
    ]);

    propsController = await deployContractUpgradeable("PropsController", propsTreasury, [
      propsTreasury.address,
      propsTreasury.address,
      propsToken.address,
      appTokenLogic.address,
      appTokenStakingLogic.address,
    ]);

    rPropsToken = await deployContractUpgradeable("RPropsToken", propsTreasury, [
      propsController.address,
      propsToken.address,
    ]);

    sPropsAppStaking = await deployContractUpgradeable("Staking", propsTreasury, [
      propsController.address,
      rPropsToken.address,
      rPropsToken.address,
      propsController.address,
      DAILY_REWARDS_EMISSION,
    ]);

    sPropsUserStaking = await deployContractUpgradeable("Staking", propsTreasury, [
      propsController.address,
      rPropsToken.address,
      rPropsToken.address,
      propsController.address,
      DAILY_REWARDS_EMISSION,
    ]);

    // The rProps token contract is allowed to mint new Props
    propsToken.connect(propsTreasury).setMinter(rPropsToken.address);

    // Initialize all needed fields on the controller
    propsController.connect(propsTreasury).setRPropsToken(rPropsToken.address);
    propsController.connect(propsTreasury).setSPropsAppStaking(sPropsAppStaking.address);
    propsController.connect(propsTreasury).setSPropsUserStaking(sPropsUserStaking.address);

    // Distribute the rProps rewards to the sProps staking contracts
    await propsController.connect(propsTreasury).distributePropsRewards(bn(800000), bn(200000));
  });

  it("successfully deploys a new app token", async () => {
    const [appToken, appTokenStaking] = await deployAppToken();

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
    expect(await appToken.balanceOf(appTokenOwner.address)).to.eq(
      APP_TOKEN_AMOUNT.sub(APP_TOKEN_AMOUNT.div(20))
    );

    // Check basic staking information
    expect(await appTokenStaking.stakingToken()).to.eq(propsToken.address);
    expect(await appTokenStaking.rewardsToken()).to.eq(appToken.address);
  });

  it("sProps are not transferrable", async () => {
    const [appToken] = await deployAppToken();

    // Stake
    const stakeAmount = bn(100);
    await propsToken.connect(propsTreasury).transfer(alice.address, stakeAmount);
    await propsToken.connect(alice).approve(propsController.address, stakeAmount);
    await propsController.connect(alice).stake([appToken.address], [stakeAmount]);

    // Try transferring
    await expect(
      propsController.connect(alice).transfer(bob.address, stakeAmount)
    ).to.be.revertedWith("sProps are not transferrable");

    // Try approving
    await expect(
      propsController.connect(alice).approve(bob.address, stakeAmount)
    ).to.be.revertedWith("sProps are not transferrable");
  });

  it("basic staking adjustment to a single app", async () => {
    const [appToken, appTokenStaking] = await deployAppToken();

    // Stake
    const stakeAmount = bn(100);
    await propsToken.connect(propsTreasury).transfer(alice.address, stakeAmount);
    await propsToken.connect(alice).approve(propsController.address, stakeAmount);
    await propsController.connect(alice).stake([appToken.address], [stakeAmount]);

    // Check the sProps balance and staked amounts
    expect(await propsController.balanceOf(alice.address)).to.eq(bn(100));
    expect(await appTokenStaking.balanceOf(alice.address)).to.eq(bn(100));
    expect(await sPropsAppStaking.balanceOf(appToken.address)).to.eq(bn(100));
    expect(await sPropsUserStaking.balanceOf(alice.address)).to.eq(bn(100));

    // Rebalance
    const adjustment = bn(-70);
    await propsController.connect(alice).stake([appToken.address], [adjustment]);

    // Check the Props balance, sProps balance and staked amounts
    expect(await propsController.balanceOf(alice.address)).to.eq(bn(30));
    expect(await appTokenStaking.balanceOf(alice.address)).to.eq(bn(30));
    expect(await sPropsAppStaking.balanceOf(appToken.address)).to.eq(bn(30));
    expect(await sPropsUserStaking.balanceOf(alice.address)).to.eq(bn(30));
    expect(await propsToken.balanceOf(alice.address)).to.eq(bn(70));
  });

  it("staking adjustment to two apps", async () => {
    const [appToken1, appTokenStaking1] = await deployAppToken();
    const [appToken2, appTokenStaking2] = await deployAppToken();

    // Stake to two apps
    const [stakeAmount1, stakeAmount2] = [bn(100), bn(50)];
    await propsToken.connect(propsTreasury).transfer(alice.address, bn(150));
    await propsToken.connect(alice).approve(propsController.address, bn(150));
    await propsController
      .connect(alice)
      .stake([appToken1.address, appToken2.address], [stakeAmount1, stakeAmount2]);

    // Check the sProps balance and staked amounts
    expect(await propsController.balanceOf(alice.address)).to.eq(bn(150));
    expect(await appTokenStaking1.balanceOf(alice.address)).to.eq(bn(100));
    expect(await appTokenStaking2.balanceOf(alice.address)).to.eq(bn(50));
    expect(await sPropsAppStaking.balanceOf(appToken1.address)).to.eq(bn(100));
    expect(await sPropsAppStaking.balanceOf(appToken2.address)).to.eq(bn(50));
    expect(await sPropsUserStaking.balanceOf(alice.address)).to.eq(bn(150));

    // Rebalance
    const [adjustment1, adjustment2] = [bn(-80), bn(100)];
    await propsToken.connect(propsTreasury).transfer(alice.address, bn(20));
    await propsToken.connect(alice).approve(propsController.address, bn(20));
    await propsController
      .connect(alice)
      .stake([appToken1.address, appToken2.address], [adjustment1, adjustment2]);

    // Check the sProps balance and staked amounts
    expect(await propsController.balanceOf(alice.address)).to.eq(bn(170));
    expect(await appTokenStaking1.balanceOf(alice.address)).to.eq(bn(20));
    expect(await appTokenStaking2.balanceOf(alice.address)).to.eq(bn(150));
    expect(await sPropsAppStaking.balanceOf(appToken1.address)).to.eq(bn(20));
    expect(await sPropsAppStaking.balanceOf(appToken2.address)).to.eq(bn(150));
    expect(await sPropsUserStaking.balanceOf(alice.address)).to.eq(bn(170));
  });

  it("staking adjustment to three apps", async () => {
    const [appToken1, appTokenStaking1] = await deployAppToken();
    const [appToken2, appTokenStaking2] = await deployAppToken();
    const [appToken3, appTokenStaking3] = await deployAppToken();

    // Stake to three apps
    const [stakeAmount1, stakeAmount2, stakeAmount3] = [bn(100), bn(50), bn(80)];
    await propsToken.connect(propsTreasury).transfer(alice.address, bn(230));
    await propsToken.connect(alice).approve(propsController.address, bn(230));
    await propsController
      .connect(alice)
      .stake(
        [appToken1.address, appToken2.address, appToken3.address],
        [stakeAmount1, stakeAmount2, stakeAmount3]
      );

    // Check the sProps balance and staked amounts
    expect(await propsController.balanceOf(alice.address)).to.eq(bn(230));
    expect(await appTokenStaking1.balanceOf(alice.address)).to.eq(bn(100));
    expect(await appTokenStaking2.balanceOf(alice.address)).to.eq(bn(50));
    expect(await appTokenStaking3.balanceOf(alice.address)).to.eq(bn(80));
    expect(await sPropsAppStaking.balanceOf(appToken1.address)).to.eq(bn(100));
    expect(await sPropsAppStaking.balanceOf(appToken2.address)).to.eq(bn(50));
    expect(await sPropsAppStaking.balanceOf(appToken3.address)).to.eq(bn(80));
    expect(await sPropsUserStaking.balanceOf(alice.address)).to.eq(bn(230));

    // Rebalance
    const [adjustment1, adjustment2, adjustment3] = [bn(-50), bn(-50), bn(-70)];
    await propsController
      .connect(alice)
      .stake(
        [appToken1.address, appToken2.address, appToken3.address],
        [adjustment1, adjustment2, adjustment3]
      );

    // Check the Props balance, sProps balance and staked amounts
    expect(await propsController.balanceOf(alice.address)).to.eq(bn(60));
    expect(await appTokenStaking1.balanceOf(alice.address)).to.eq(bn(50));
    expect(await appTokenStaking2.balanceOf(alice.address)).to.eq(bn(0));
    expect(await appTokenStaking3.balanceOf(alice.address)).to.eq(bn(10));
    expect(await sPropsAppStaking.balanceOf(appToken1.address)).to.eq(bn(50));
    expect(await sPropsAppStaking.balanceOf(appToken2.address)).to.eq(bn(0));
    expect(await sPropsAppStaking.balanceOf(appToken3.address)).to.eq(bn(10));
    expect(await sPropsUserStaking.balanceOf(alice.address)).to.eq(bn(60));
    expect(await propsToken.balanceOf(alice.address)).to.eq(bn(170));
  });

  it("properly handles an invalid staking adjustment", async () => {
    const [appToken] = await deployAppToken();

    // No approval to transfer tokens
    await expect(
      propsController.connect(alice).stake([appToken.address], [bn(100)])
    ).to.be.revertedWith("ERC20: transfer amount exceeds balance");

    // Stake amount underflow
    await expect(
      propsController.connect(alice).stake([appToken.address], [bn(-100)])
    ).to.be.revertedWith("SafeMath: subtraction overflow");
  });

  it("stake by off-chain signature", async () => {
    const [appToken, appTokenStaking] = await deployAppToken();

    const stakeAmount = bn(100);

    const permitDeadline = (await now()).add(daysToTimestamp(1));
    const approvalDigest = await getApprovalDigest(
      propsToken,
      {
        owner: alice.address,
        spender: propsController.address,
        value: stakeAmount,
      },
      await propsToken.nonces(alice.address),
      permitDeadline
    );

    // Sign the approval digest
    const sig = ethUtil.ecsign(
      Buffer.from(approvalDigest.slice(2), "hex"),
      Buffer.from(
        accounts
          .find(({ privateKey }) => getPublicKey(privateKey) === alice.address)!
          .privateKey.slice(2),
        "hex"
      )
    );

    // Stake by off-chain signature
    await propsToken.connect(propsTreasury).transfer(alice.address, stakeAmount);
    await propsController
      .connect(alice)
      .stakeBySig(
        [appToken.address],
        [stakeAmount],
        alice.address,
        propsController.address,
        stakeAmount,
        permitDeadline,
        sig.v,
        sig.r,
        sig.s
      );

    // Check the sProps balance and staked amounts
    expect(await propsController.balanceOf(alice.address)).to.eq(bn(100));
    expect(await appTokenStaking.balanceOf(alice.address)).to.eq(bn(100));
    expect(await sPropsAppStaking.balanceOf(appToken.address)).to.eq(bn(100));
    expect(await sPropsUserStaking.balanceOf(alice.address)).to.eq(bn(100));
  });

  it("stake on behalf of an account", async () => {
    const [appToken, appTokenStaking] = await deployAppToken();

    // Stake
    const stakeAmount = bn(100);
    await propsToken.connect(propsTreasury).transfer(alice.address, stakeAmount);
    await propsToken.connect(alice).approve(propsController.address, stakeAmount);
    await propsController
      .connect(alice)
      .stakeOnBehalf([appToken.address], [stakeAmount], bob.address);

    // Check the sProps balance and staked amounts are all under Bob' ownership
    expect(await propsController.balanceOf(bob.address)).to.eq(bn(100));
    expect(await appTokenStaking.balanceOf(bob.address)).to.eq(bn(100));
    expect(await sPropsAppStaking.balanceOf(appToken.address)).to.eq(bn(100));
    expect(await sPropsUserStaking.balanceOf(bob.address)).to.eq(bn(100));

    // Check Alice has nothing staked
    expect(await propsController.balanceOf(alice.address)).to.eq(bn(0));
    expect(await appTokenStaking.balanceOf(alice.address)).to.eq(bn(0));
    expect(await sPropsUserStaking.balanceOf(alice.address)).to.eq(bn(0));
  });

  it("stake on behalf by off-chain signature", async () => {
    const [appToken, appTokenStaking] = await deployAppToken();

    const stakeAmount = bn(100);

    const permitDeadline = (await now()).add(daysToTimestamp(1));
    const approvalDigest = await getApprovalDigest(
      propsToken,
      {
        owner: alice.address,
        spender: propsController.address,
        value: stakeAmount,
      },
      await propsToken.nonces(alice.address),
      permitDeadline
    );

    // Sign the approval digest
    const sig = ethUtil.ecsign(
      Buffer.from(approvalDigest.slice(2), "hex"),
      Buffer.from(
        accounts
          .find(({ privateKey }) => getPublicKey(privateKey) === alice.address)!
          .privateKey.slice(2),
        "hex"
      )
    );

    // Stake by off-chain signature
    await propsToken.connect(propsTreasury).transfer(alice.address, stakeAmount);
    await propsToken.connect(alice).approve(propsController.address, stakeAmount);
    await propsController
      .connect(alice)
      .stakeOnBehalfBySig(
        [appToken.address],
        [stakeAmount],
        bob.address,
        alice.address,
        propsController.address,
        stakeAmount,
        permitDeadline,
        sig.v,
        sig.r,
        sig.s
      );

    // Check the sProps balance and staked amounts are all under Bob' ownership
    expect(await propsController.balanceOf(bob.address)).to.eq(bn(100));
    expect(await appTokenStaking.balanceOf(bob.address)).to.eq(bn(100));
    expect(await sPropsAppStaking.balanceOf(appToken.address)).to.eq(bn(100));
    expect(await sPropsUserStaking.balanceOf(bob.address)).to.eq(bn(100));

    // Check Alice has nothing staked
    expect(await propsController.balanceOf(alice.address)).to.eq(bn(0));
    expect(await appTokenStaking.balanceOf(alice.address)).to.eq(bn(0));
    expect(await sPropsUserStaking.balanceOf(alice.address)).to.eq(bn(0));
  });

  it("basic rewards staking adjustment to a single app", async () => {
    const [appToken, appTokenStaking] = await deployAppToken();

    // Stake
    const principalStakeAmount = bn(100);
    await propsToken.connect(propsTreasury).transfer(alice.address, principalStakeAmount);
    await propsToken.connect(alice).approve(propsController.address, principalStakeAmount);
    await propsController.connect(alice).stake([appToken.address], [principalStakeAmount]);

    // Fast-forward a few days
    await mineBlock((await now()).add(daysToTimestamp(10)));

    // Claim user Props rewards
    await propsController.connect(alice).claimUserPropsRewards();

    const escrowedRewards = await propsController.rewardsEscrow(alice.address);
    const rewardsStakeAmount = escrowedRewards.div(2);

    // Stake the escrowed rewards
    await propsController.connect(alice).stakeRewards([appToken.address], [rewardsStakeAmount]);

    // Check the sProps balance and staked amounts
    expect(await propsController.balanceOf(alice.address)).to.eq(
      principalStakeAmount.add(rewardsStakeAmount)
    );
    expect(await appTokenStaking.balanceOf(alice.address)).to.eq(
      principalStakeAmount.add(rewardsStakeAmount)
    );
    expect(await sPropsAppStaking.balanceOf(appToken.address)).to.eq(
      principalStakeAmount.add(rewardsStakeAmount)
    );
    expect(await sPropsUserStaking.balanceOf(alice.address)).to.eq(
      principalStakeAmount.add(rewardsStakeAmount)
    );

    // Check the escrow
    expect(await propsController.rewardsEscrow(alice.address)).to.eq(
      escrowedRewards.sub(rewardsStakeAmount)
    );

    // Rebalance
    const rebalanceTime = await getTxTimestamp(
      await propsController
        .connect(alice)
        .stakeRewards([appToken.address], [rewardsStakeAmount.mul(-1)])
    );

    // Check the sProps balance and staked amounts
    expect(await propsController.balanceOf(alice.address)).to.eq(principalStakeAmount);
    expect(await appTokenStaking.balanceOf(alice.address)).to.eq(principalStakeAmount);
    expect(await sPropsAppStaking.balanceOf(appToken.address)).to.eq(principalStakeAmount);
    expect(await sPropsUserStaking.balanceOf(alice.address)).to.eq(principalStakeAmount);

    // Check the escrow
    expect(await propsController.rewardsEscrow(alice.address)).to.eq(escrowedRewards);
    expect(await propsController.rewardsEscrowUnlock(alice.address)).to.eq(
      rebalanceTime.add(await propsController.rewardsEscrowCooldown())
    );
  });

  it("rewards staking adjustment to two apps", async () => {
    const [appToken1, appTokenStaking1] = await deployAppToken();
    const [appToken2, appTokenStaking2] = await deployAppToken();

    // Stake
    const [principalStakeAmount1, principalStakeAmount2] = [bn(50), bn(70)];
    await propsToken.connect(propsTreasury).transfer(alice.address, bn(120));
    await propsToken.connect(alice).approve(propsController.address, bn(120));
    await propsController
      .connect(alice)
      .stake(
        [appToken1.address, appToken2.address],
        [principalStakeAmount1, principalStakeAmount2]
      );

    // Fast-forward a few days
    await mineBlock((await now()).add(daysToTimestamp(10)));

    // Claim user Props rewards
    await propsController.connect(alice).claimUserPropsRewards();

    const escrowedRewards = await propsController.rewardsEscrow(alice.address);
    const [rewardsStakeAmount1, rewardsStakeAmount2] = [
      escrowedRewards.div(2),
      escrowedRewards.div(4),
    ];

    // Stake the escrowed rewards
    await propsController
      .connect(alice)
      .stakeRewards(
        [appToken1.address, appToken2.address],
        [rewardsStakeAmount1, rewardsStakeAmount2]
      );

    // Check the escrow
    expect(await propsController.rewardsEscrow(alice.address)).to.eq(
      escrowedRewards.sub(rewardsStakeAmount1.add(rewardsStakeAmount2))
    );

    // Rebalance
    const rebalanceTime = await getTxTimestamp(
      await propsController
        .connect(alice)
        .stakeRewards(
          [appToken1.address, appToken2.address],
          [rewardsStakeAmount1.mul(-1), rewardsStakeAmount1.div(2)]
        )
    );

    // Check the sProps balance and staked amounts
    expect(await propsController.balanceOf(alice.address)).to.eq(
      principalStakeAmount1
        .add(principalStakeAmount2)
        .add(rewardsStakeAmount2)
        .add(rewardsStakeAmount1.div(2))
    );
    expect(await appTokenStaking1.balanceOf(alice.address)).to.eq(principalStakeAmount1);
    expect(await appTokenStaking2.balanceOf(alice.address)).to.eq(
      principalStakeAmount2.add(rewardsStakeAmount2).add(rewardsStakeAmount1.div(2))
    );
    expect(await sPropsAppStaking.balanceOf(appToken1.address)).to.eq(principalStakeAmount1);
    expect(await sPropsAppStaking.balanceOf(appToken2.address)).to.eq(
      principalStakeAmount2.add(rewardsStakeAmount2).add(rewardsStakeAmount1.div(2))
    );
    expect(await sPropsUserStaking.balanceOf(alice.address)).to.eq(
      principalStakeAmount1
        .add(principalStakeAmount2)
        .add(rewardsStakeAmount2)
        .add(rewardsStakeAmount1.div(2))
    );

    // Check the escrow
    expect(await propsController.rewardsEscrow(alice.address)).to.eq(
      escrowedRewards.sub(rewardsStakeAmount2.add(rewardsStakeAmount1.div(2)))
    );
    expect(await propsController.rewardsEscrowUnlock(alice.address)).to.eq(
      rebalanceTime.add(await propsController.rewardsEscrowCooldown())
    );
  });

  it("claim app token rewards", async () => {
    const [appToken, appTokenStaking] = await deployAppToken();

    // Distribute app token rewards
    const rewardAmount = expandTo18Decimals(10000);
    await appToken.connect(appTokenOwner).transfer(appTokenStaking.address, rewardAmount);
    await appTokenStaking.connect(appTokenOwner).notifyRewardAmount(rewardAmount);

    // Stake
    const stakeAmount = bn(100);
    await propsToken.connect(propsTreasury).transfer(alice.address, stakeAmount);
    await propsToken.connect(alice).approve(propsController.address, stakeAmount);
    await propsController.connect(alice).stake([appToken.address], [stakeAmount]);

    // Fast-forward a few days
    await mineBlock((await now()).add(daysToTimestamp(10)));

    const earned = await appTokenStaking.earned(alice.address);

    // Claim app token rewards
    await propsController.connect(alice).claimAppTokenRewards(appToken.address);

    // Ensure results are within .01%
    const inWallet = await appToken.balanceOf(alice.address);
    expect(earned.sub(inWallet).abs().lte(inWallet.div(10000))).to.be.true;
  });

  it("claim app Props rewards", async () => {
    const [appToken] = await deployAppToken();

    // Stake
    const stakeAmount = bn(100);
    await propsToken.connect(propsTreasury).transfer(alice.address, stakeAmount);
    await propsToken.connect(alice).approve(propsController.address, stakeAmount);
    await propsController.connect(alice).stake([appToken.address], [stakeAmount]);

    // Fast-forward a few days
    await mineBlock((await now()).add(daysToTimestamp(10)));

    // Only the app token's owner can claim app Props rewards
    await expect(
      propsController.connect(alice).claimAppPropsRewards(appToken.address)
    ).to.be.revertedWith("Only the app token owner can claim app rewards");

    const earned = await sPropsAppStaking.earned(appToken.address);

    // Claim app Props rewards
    await propsController.connect(appTokenOwner).claimAppPropsRewards(appToken.address);

    // Make sure the app owner has no rProps in their wallet
    expect(await rPropsToken.balanceOf(appTokenOwner.address)).to.eq(bn(0));

    // Ensure results are within .01%
    const inWallet = await propsToken.balanceOf(appTokenOwner.address);
    expect(earned.sub(inWallet).abs().lte(inWallet.div(10000))).to.be.true;
  });

  it("claim user Props rewards", async () => {
    const [appToken] = await deployAppToken();

    // Stake
    const stakeAmount = bn(100);
    await propsToken.connect(propsTreasury).transfer(alice.address, stakeAmount);
    await propsToken.connect(alice).approve(propsController.address, stakeAmount);
    await propsController.connect(alice).stake([appToken.address], [stakeAmount]);

    // Fast-forward a few days
    await mineBlock((await now()).add(daysToTimestamp(10)));

    const earned = await sPropsUserStaking.earned(alice.address);

    // Claim user Props rewards
    await propsController.connect(alice).claimUserPropsRewards();

    // Make sure the user Props rewards weren't directly transferred to their wallet
    expect(await propsToken.balanceOf(alice.address)).to.eq(bn(0));

    // Make sure the user has no rProps in their wallet
    expect(await rPropsToken.balanceOf(alice.address)).to.eq(bn(0));

    // Ensure results are within .01%
    const inEscrow = await propsController.rewardsEscrow(alice.address);
    expect(earned.sub(inEscrow).abs().lte(inEscrow.div(10000))).to.be.true;
  });

  it("directly stake user Props rewards", async () => {
    const [appToken1, appTokenStaking1] = await deployAppToken();
    const [appToken2, appTokenStaking2] = await deployAppToken();

    // Stake
    const [principalStakeAmount1, principalStakeAmount2] = [bn(50), bn(70)];
    await propsToken.connect(propsTreasury).transfer(alice.address, bn(120));
    await propsToken.connect(alice).approve(propsController.address, bn(120));
    await propsController
      .connect(alice)
      .stake(
        [appToken1.address, appToken2.address],
        [principalStakeAmount1, principalStakeAmount2]
      );

    // Fast-forward a few days
    await mineBlock((await now()).add(daysToTimestamp(10)));

    const earned = await sPropsUserStaking.earned(alice.address);

    // Claim and directly stake user Props rewards
    await propsController
      .connect(alice)
      .claimUserPropsRewardsAndStake(
        [appToken1.address, appToken2.address],
        [bn(300000), bn(700000)]
      );

    // Make sure the user has no rProps in their wallet
    expect(await rPropsToken.balanceOf(alice.address)).to.eq(bn(0));

    // Check the sProps balance (ensure results are within .01%)
    const sPropsBalance = await propsController.balanceOf(alice.address);
    const localSPropsBalance = principalStakeAmount1.add(principalStakeAmount2).add(earned);
    expect(sPropsBalance.sub(localSPropsBalance).abs().lte(sPropsBalance.div(10000))).to.be.true;

    // Check the amounts staked to the app token staking contracts (ensure results are within .01%)
    const appTokenStakingAmount1 = await appTokenStaking1.balanceOf(alice.address);
    const localAppTokenStakingAmount1 = earned.mul(30).div(100);
    expect(
      appTokenStakingAmount1
        .sub(localAppTokenStakingAmount1)
        .abs()
        .lte(appTokenStakingAmount1.div(10000))
    ).to.be.true;

    const appTokenStakingAmount2 = await appTokenStaking2.balanceOf(alice.address);
    const localAppTokenStakingAmount2 = earned.mul(70).div(100);

    expect(
      appTokenStakingAmount2
        .sub(localAppTokenStakingAmount2)
        .abs()
        .lte(appTokenStakingAmount2.div(10000))
    ).to.be.true;

    // Check the escrow
    expect(await propsController.rewardsEscrow(alice.address)).to.eq(bn(0));
  });

  it("unlock user Props rewards", async () => {
    const [appToken] = await deployAppToken();

    // Stake
    const stakeAmount = bn(100);
    await propsToken.connect(propsTreasury).transfer(alice.address, stakeAmount);
    await propsToken.connect(alice).approve(propsController.address, stakeAmount);
    await propsController.connect(alice).stake([appToken.address], [stakeAmount]);

    // Fast-forward a few days
    await mineBlock((await now()).add(daysToTimestamp(10)));

    const earned = await sPropsUserStaking.earned(alice.address);

    // Claim user Props rewards
    await propsController.connect(alice).claimUserPropsRewards();

    // Try to unlock the escrowed rewards
    await expect(propsController.connect(alice).unlockUserPropsRewards()).to.be.revertedWith(
      "Rewards are still in cooldown"
    );

    // Fast-forward until after the rewards cooldown period
    await mineBlock((await propsController.rewardsEscrowUnlock(alice.address)).add(1));

    // Unlock the escrowed rewards
    await propsController.connect(alice).unlockUserPropsRewards();

    // Make sure the user has no rProps in their wallet
    expect(await rPropsToken.balanceOf(alice.address)).to.eq(bn(0));

    // Ensure results are within .01%
    const inWallet = await propsToken.balanceOf(alice.address);
    expect(earned.sub(inWallet).abs().lte(inWallet.div(10000))).to.be.true;
  });

  it("proper permissioning", async () => {
    // Only the owner can set the rewards escrow cooldown
    await expect(
      propsController.connect(alice).setRewardsEscrowCooldown(bn(10))
    ).to.be.revertedWith("Ownable: caller is not the owner");
    expect(await propsController.connect(propsTreasury).setRewardsEscrowCooldown(bn(10)));

    const mockAddress = bob.address;

    // Only the owner can set the app token logic
    await expect(propsController.connect(alice).setAppTokenLogic(mockAddress)).to.be.revertedWith(
      "Ownable: caller is not the owner"
    );
    expect(await propsController.connect(propsTreasury).setAppTokenLogic(mockAddress));

    // Only the owner can set the app token staking logic
    await expect(
      propsController.connect(alice).setAppTokenStakingLogic(mockAddress)
    ).to.be.revertedWith("Ownable: caller is not the owner");
    expect(await propsController.connect(propsTreasury).setAppTokenStakingLogic(mockAddress));

    // Only the owner can whitelist app tokens
    await expect(propsController.connect(alice).whitelistAppToken(mockAddress)).to.be.revertedWith(
      "Ownable: caller is not the owner"
    );
    expect(await propsController.connect(propsTreasury).whitelistAppToken(mockAddress));

    // Only the owner can blacklist app tokens
    await expect(propsController.connect(alice).blacklistAppToken(mockAddress)).to.be.revertedWith(
      "Ownable: caller is not the owner"
    );
    expect(await propsController.connect(propsTreasury).blacklistAppToken(mockAddress));
  });
});
