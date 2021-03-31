import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import chai from "chai";
import * as ethUtil from "ethereumjs-util";
import { solidity } from "ethereum-waffle";
import * as sigUtil from "eth-sig-util";
import { ethers } from "hardhat";

import type {
  AppPointsL2,
  AppProxyFactoryL2,
  PropsProtocol,
  PropsTokenL2,
  RPropsToken,
  SPropsToken,
  Staking,
} from "../typechain";
import {
  bn,
  daysToTimestamp,
  deployContract,
  deployContractUpgradeable,
  expandTo18Decimals,
  getEvents,
  getPrivateKey,
  getTxTimestamp,
  mineBlock,
  now,
} from "../utils";

chai.use(solidity);
const { expect } = chai;

describe("PropsProtocol", () => {
  let deployer: SignerWithAddress;
  let controller: SignerWithAddress;
  let guardian: SignerWithAddress;
  let appProxyFactoryBridge: SignerWithAddress;
  let appOwner: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;
  let mock: SignerWithAddress;

  let propsToken: PropsTokenL2;
  let rPropsToken: RPropsToken;
  let sPropsToken: SPropsToken;
  let propsAppStaking: Staking;
  let propsUserStaking: Staking;
  let appProxyFactory: AppProxyFactoryL2;
  let propsProtocol: PropsProtocol;

  const PROPS_TOKEN_AMOUNT = expandTo18Decimals(100000000);
  const RPROPS_TOKEN_AMOUNT = expandTo18Decimals(10000);
  const APP_POINTS_TOKEN_NAME = "AppPoints";
  const APP_POINTS_TOKEN_SYMBOL = "AppPoints";
  const APP_POINTS_TOKEN_AMOUNT = expandTo18Decimals(100000);
  // Corresponds to 0.0003658 - taken from old Props rewards formula
  // Distributes 12.5% of the remaining rewards pool each year
  const DAILY_REWARDS_EMISSION = bn(3658).mul(1e11);

  const deployApp = async (): Promise<[AppPointsL2, Staking]> => {
    const tx = await appProxyFactory.connect(appProxyFactoryBridge).deployApp(
      // Mock the L1 AppPoints address
      "0x0000000000000000000000000000000000000000",
      APP_POINTS_TOKEN_NAME,
      APP_POINTS_TOKEN_SYMBOL,
      appOwner.address,
      DAILY_REWARDS_EMISSION
    );
    const [[, appPointsAddress, appPointsStakingAddress]] = await getEvents(
      await tx.wait(),
      "AppDeployed(address,address,address,string,string,address)",
      "AppProxyFactoryL2"
    );

    const appPoints = (await ethers.getContractFactory("AppPointsL2")).attach(
      appPointsAddress
    ) as AppPointsL2;

    // Mimick cross-chain deposit
    await appPoints.connect(appOwner).setMinter(appOwner.address);
    await appPoints
      .connect(appOwner)
      .deposit(
        appOwner.address,
        new ethers.utils.AbiCoder().encode(["uint256"], [APP_POINTS_TOKEN_AMOUNT])
      );

    await propsProtocol.connect(controller).updateAppWhitelist(appPointsAddress, true);

    return [
      appPoints,
      (await ethers.getContractFactory("Staking")).attach(appPointsStakingAddress) as Staking,
    ];
  };

  beforeEach(async () => {
    [
      deployer,
      controller,
      guardian,
      appProxyFactoryBridge,
      appOwner,
      alice,
      bob,
      mock,
    ] = await ethers.getSigners();

    propsToken = await deployContractUpgradeable("PropsTokenL2", deployer, deployer.address);

    propsProtocol = await deployContractUpgradeable(
      "PropsProtocol",
      deployer,
      controller.address,
      guardian.address,
      propsToken.address
    );

    rPropsToken = await deployContractUpgradeable(
      "RPropsToken",
      deployer,
      propsProtocol.address,
      propsToken.address
    );

    sPropsToken = await deployContractUpgradeable("SPropsToken", deployer, propsProtocol.address);

    propsAppStaking = await deployContractUpgradeable(
      "Staking",
      deployer,
      propsProtocol.address,
      rPropsToken.address,
      rPropsToken.address,
      DAILY_REWARDS_EMISSION
    );

    propsUserStaking = await deployContractUpgradeable(
      "Staking",
      deployer,
      propsProtocol.address,
      rPropsToken.address,
      rPropsToken.address,
      DAILY_REWARDS_EMISSION
    );

    const appPointsLogic = await deployContract("AppPointsL2", deployer);
    const appPointsStakingLogic = await deployContract("Staking", deployer);

    appProxyFactory = await deployContractUpgradeable(
      "AppProxyFactoryL2",
      deployer,
      controller.address,
      propsProtocol.address,
      propsToken.address,
      appPointsLogic.address,
      appPointsStakingLogic.address
    );

    // Mint some Props tokens beforehand
    await propsToken.connect(deployer).addMinter(deployer.address);
    await propsToken.connect(deployer).mint(deployer.address, PROPS_TOKEN_AMOUNT);

    // Set needed parameters
    await propsToken.connect(deployer).addMinter(rPropsToken.address);
    await appProxyFactory
      .connect(controller)
      .changeAppProxyFactoryBridge(appProxyFactoryBridge.address);
    await propsProtocol.connect(controller).setAppProxyFactory(appProxyFactory.address);
    await propsProtocol.connect(controller).setRPropsToken(rPropsToken.address);
    await propsProtocol.connect(controller).setSPropsToken(sPropsToken.address);
    await propsProtocol.connect(controller).setPropsAppStaking(propsAppStaking.address);
    await propsProtocol.connect(controller).setPropsUserStaking(propsUserStaking.address);

    // Distribute the rProps rewards to the sProps staking contracts
    await propsProtocol
      .connect(controller)
      .distributePropsRewards(RPROPS_TOKEN_AMOUNT, bn(800000), bn(200000));
  });

  it("sProps are not transferrable", async () => {
    const [appPoints] = await deployApp();

    // Stake
    const stakeAmount = expandTo18Decimals(100);
    await propsToken.connect(deployer).transfer(alice.address, stakeAmount);
    await propsToken.connect(alice).approve(propsProtocol.address, stakeAmount);
    await propsProtocol.connect(alice).stake([appPoints.address], [stakeAmount]);

    // Try transferring
    await expect(sPropsToken.connect(alice).transfer(bob.address, stakeAmount)).to.be.revertedWith(
      "sProps are not transferrable"
    );
  });

  it("basic staking adjustment to a single app", async () => {
    const [appPoints, appPointsStaking] = await deployApp();

    // Stake
    const stakeAmount = expandTo18Decimals(100);
    await propsToken.connect(deployer).transfer(alice.address, stakeAmount);
    await propsToken.connect(alice).approve(propsProtocol.address, stakeAmount);
    const tx = await propsProtocol.connect(alice).stake([appPoints.address], [stakeAmount]);

    // Check that `Staked` events got emitted
    const [[app, account, amount, rewards]] = await getEvents(
      await tx.wait(),
      "Staked(address,address,int256,bool)",
      "PropsProtocol"
    );
    expect(app).to.eq(appPoints.address);
    expect(account).to.eq(alice.address);
    expect(amount).to.eq(stakeAmount);
    expect(rewards).to.eq(false);

    // Check the sProps balance and staked amounts
    expect(await sPropsToken.balanceOf(alice.address)).to.eq(stakeAmount);
    expect(await appPointsStaking.balanceOf(alice.address)).to.eq(stakeAmount);
    expect(await propsAppStaking.balanceOf(appPoints.address)).to.eq(stakeAmount);
    expect(await propsUserStaking.balanceOf(alice.address)).to.eq(stakeAmount);

    // Rebalance
    const adjustment = expandTo18Decimals(-70);
    await propsProtocol.connect(alice).stake([appPoints.address], [adjustment]);

    // Check the Props balance, sProps balance and staked amounts
    expect(await sPropsToken.balanceOf(alice.address)).to.eq(expandTo18Decimals(30));
    expect(await appPointsStaking.balanceOf(alice.address)).to.eq(expandTo18Decimals(30));
    expect(await propsAppStaking.balanceOf(appPoints.address)).to.eq(expandTo18Decimals(30));
    expect(await propsUserStaking.balanceOf(alice.address)).to.eq(expandTo18Decimals(30));
    expect(await propsToken.balanceOf(alice.address)).to.eq(expandTo18Decimals(70));
  });

  it("staking adjustment to two apps", async () => {
    const [appPoints1, appPointsStaking1] = await deployApp();
    const [appPoints2, appPointsStaking2] = await deployApp();

    // Stake to two apps
    const [stakeAmount1, stakeAmount2] = [expandTo18Decimals(100), expandTo18Decimals(50)];
    await propsToken.connect(deployer).transfer(alice.address, expandTo18Decimals(150));
    await propsToken.connect(alice).approve(propsProtocol.address, expandTo18Decimals(150));
    await propsProtocol
      .connect(alice)
      .stake([appPoints1.address, appPoints2.address], [stakeAmount1, stakeAmount2]);

    // Check the sProps balance and staked amounts
    expect(await sPropsToken.balanceOf(alice.address)).to.eq(expandTo18Decimals(150));
    expect(await appPointsStaking1.balanceOf(alice.address)).to.eq(expandTo18Decimals(100));
    expect(await appPointsStaking2.balanceOf(alice.address)).to.eq(expandTo18Decimals(50));
    expect(await propsAppStaking.balanceOf(appPoints1.address)).to.eq(expandTo18Decimals(100));
    expect(await propsAppStaking.balanceOf(appPoints2.address)).to.eq(expandTo18Decimals(50));
    expect(await propsUserStaking.balanceOf(alice.address)).to.eq(expandTo18Decimals(150));

    // Rebalance
    const [adjustment1, adjustment2] = [expandTo18Decimals(-80), expandTo18Decimals(100)];
    await propsToken.connect(deployer).transfer(alice.address, expandTo18Decimals(20));
    await propsToken.connect(alice).approve(propsProtocol.address, expandTo18Decimals(20));
    await propsProtocol
      .connect(alice)
      .stake([appPoints1.address, appPoints2.address], [adjustment1, adjustment2]);

    // Check the sProps balance and staked amounts
    expect(await sPropsToken.balanceOf(alice.address)).to.eq(expandTo18Decimals(170));
    expect(await appPointsStaking1.balanceOf(alice.address)).to.eq(expandTo18Decimals(20));
    expect(await appPointsStaking2.balanceOf(alice.address)).to.eq(expandTo18Decimals(150));
    expect(await propsAppStaking.balanceOf(appPoints1.address)).to.eq(expandTo18Decimals(20));
    expect(await propsAppStaking.balanceOf(appPoints2.address)).to.eq(expandTo18Decimals(150));
    expect(await propsUserStaking.balanceOf(alice.address)).to.eq(expandTo18Decimals(170));
  });

  it("staking adjustment to three apps", async () => {
    const [appPoints1, appPointsStaking1] = await deployApp();
    const [appPoints2, appPointsStaking2] = await deployApp();
    const [appPoints3, appPointsStaking3] = await deployApp();

    // Stake to three apps
    const [stakeAmount1, stakeAmount2, stakeAmount3] = [
      expandTo18Decimals(100),
      expandTo18Decimals(50),
      expandTo18Decimals(80),
    ];
    await propsToken.connect(deployer).transfer(alice.address, expandTo18Decimals(230));
    await propsToken.connect(alice).approve(propsProtocol.address, expandTo18Decimals(230));
    await propsProtocol
      .connect(alice)
      .stake(
        [appPoints1.address, appPoints2.address, appPoints3.address],
        [stakeAmount1, stakeAmount2, stakeAmount3]
      );

    // Check the sProps balance and staked amounts
    expect(await sPropsToken.balanceOf(alice.address)).to.eq(expandTo18Decimals(230));
    expect(await appPointsStaking1.balanceOf(alice.address)).to.eq(expandTo18Decimals(100));
    expect(await appPointsStaking2.balanceOf(alice.address)).to.eq(expandTo18Decimals(50));
    expect(await appPointsStaking3.balanceOf(alice.address)).to.eq(expandTo18Decimals(80));
    expect(await propsAppStaking.balanceOf(appPoints1.address)).to.eq(expandTo18Decimals(100));
    expect(await propsAppStaking.balanceOf(appPoints2.address)).to.eq(expandTo18Decimals(50));
    expect(await propsAppStaking.balanceOf(appPoints3.address)).to.eq(expandTo18Decimals(80));
    expect(await propsUserStaking.balanceOf(alice.address)).to.eq(expandTo18Decimals(230));

    // Rebalance
    const [adjustment1, adjustment2, adjustment3] = [
      expandTo18Decimals(-50),
      expandTo18Decimals(-50),
      expandTo18Decimals(-70),
    ];
    await propsProtocol
      .connect(alice)
      .stake(
        [appPoints1.address, appPoints2.address, appPoints3.address],
        [adjustment1, adjustment2, adjustment3]
      );

    // Check the Props balance, sProps balance and staked amounts
    expect(await sPropsToken.balanceOf(alice.address)).to.eq(expandTo18Decimals(60));
    expect(await appPointsStaking1.balanceOf(alice.address)).to.eq(expandTo18Decimals(50));
    expect(await appPointsStaking2.balanceOf(alice.address)).to.eq(bn(0));
    expect(await appPointsStaking3.balanceOf(alice.address)).to.eq(expandTo18Decimals(10));
    expect(await propsAppStaking.balanceOf(appPoints1.address)).to.eq(expandTo18Decimals(50));
    expect(await propsAppStaking.balanceOf(appPoints2.address)).to.eq(bn(0));
    expect(await propsAppStaking.balanceOf(appPoints3.address)).to.eq(expandTo18Decimals(10));
    expect(await propsUserStaking.balanceOf(alice.address)).to.eq(expandTo18Decimals(60));
    expect(await propsToken.balanceOf(alice.address)).to.eq(expandTo18Decimals(170));
  });

  it("various staking edge cases", async () => {
    const [appPoints] = await deployApp();

    // Empty stake
    const emptyStakeTx = await propsProtocol.connect(alice).stake([], []);
    // Check that no `Staked` events got emitted
    expect(
      await getEvents(
        await emptyStakeTx.wait(),
        "Staked(address,address,int256,bool)",
        "PropsProtocol"
      )
    ).is.empty;

    // Invalid inputs
    await expect(propsProtocol.connect(alice).stake([appPoints.address], [])).to.be.revertedWith(
      "Invalid input"
    );

    // Stake an amount of 0
    const zeroStakeTx = await propsProtocol.connect(alice).stake([appPoints.address], [0]);
    // Check that no `Staked` events got emitted
    expect(
      await getEvents(
        await zeroStakeTx.wait(),
        "Staked(address,address,int256,bool)",
        "PropsProtocol"
      )
    ).is.empty;
  });

  it("properly handles an invalid staking adjustment", async () => {
    const [appPoints1] = await deployApp();
    const [appPoints2] = await deployApp();

    // No approval to transfer tokens
    await expect(
      propsProtocol.connect(alice).stake([appPoints1.address], [expandTo18Decimals(100)])
    ).to.be.revertedWith("ERC20: transfer amount exceeds balance");

    // Stake amount underflow
    await expect(
      propsProtocol.connect(alice).stake([appPoints1.address], [expandTo18Decimals(-100)])
    ).to.be.revertedWith("SafeMath: subtraction overflow");

    // Various invalid scenarios with multiple apps
    await propsToken.connect(deployer).transfer(alice.address, expandTo18Decimals(1000));
    await propsToken.connect(alice).approve(propsProtocol.address, expandTo18Decimals(1000));
    await propsProtocol
      .connect(alice)
      .stake(
        [appPoints1.address, appPoints2.address],
        [expandTo18Decimals(50), expandTo18Decimals(50)]
      );
    await expect(
      propsProtocol
        .connect(alice)
        .stake(
          [appPoints1.address, appPoints2.address],
          [expandTo18Decimals(-60), expandTo18Decimals(60)]
        )
    ).to.be.revertedWith("SafeMath: subtraction overflow");
    await expect(
      propsProtocol
        .connect(alice)
        .stake(
          [appPoints1.address, appPoints2.address],
          [expandTo18Decimals(60), expandTo18Decimals(-60)]
        )
    ).to.be.revertedWith("SafeMath: subtraction overflow");
    await expect(
      propsProtocol
        .connect(alice)
        .stake(
          [appPoints1.address, appPoints2.address],
          [expandTo18Decimals(900), expandTo18Decimals(1)]
        )
    ).to.be.revertedWith("ERC20: transfer amount exceeds balance");
  });

  it("stake with permit", async () => {
    const [appPoints, appPointsStaking] = await deployApp();

    const stakeAmount = expandTo18Decimals(100);

    // Sign the permit
    const permitMessage = {
      owner: alice.address,
      spender: propsProtocol.address,
      value: stakeAmount.toString(),
      nonce: (await propsToken.nonces(alice.address)).toString(),
      deadline: (await now()).add(daysToTimestamp(1)).toString(),
    };

    const permitData = {
      domain: {
        chainId: (await ethers.provider.getNetwork()).chainId,
        name: await propsToken.name(),
        verifyingContract: propsToken.address,
        version: "1",
      },
      message: permitMessage,
      primaryType: "Permit" as const,
      types: {
        EIP712Domain: [
          { name: "name", type: "string" },
          { name: "version", type: "string" },
          { name: "chainId", type: "uint256" },
          { name: "verifyingContract", type: "address" },
        ],
        Permit: [
          { name: "owner", type: "address" },
          { name: "spender", type: "address" },
          { name: "value", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      },
    };

    const permitSig = ethUtil.fromRpcSig(
      sigUtil.signTypedData_v4(getPrivateKey(alice.address), { data: permitData })
    );

    // Stake with permit
    await propsToken.connect(deployer).transfer(alice.address, stakeAmount);
    await propsProtocol
      .connect(alice)
      .stakeWithPermit(
        [appPoints.address],
        [stakeAmount],
        permitMessage.owner,
        permitMessage.spender,
        permitMessage.value,
        permitMessage.deadline,
        permitSig.v,
        permitSig.r,
        permitSig.s
      );

    // Check the sProps balance and staked amounts
    expect(await sPropsToken.balanceOf(alice.address)).to.eq(stakeAmount);
    expect(await appPointsStaking.balanceOf(alice.address)).to.eq(stakeAmount);
    expect(await propsAppStaking.balanceOf(appPoints.address)).to.eq(stakeAmount);
    expect(await propsUserStaking.balanceOf(alice.address)).to.eq(stakeAmount);
  });

  it("stake on behalf", async () => {
    const [appPoints, appPointsStaking] = await deployApp();

    // Stake
    const stakeAmount = expandTo18Decimals(100);
    await propsToken.connect(deployer).transfer(alice.address, stakeAmount);
    await propsToken.connect(alice).approve(propsProtocol.address, stakeAmount);
    await propsProtocol
      .connect(alice)
      .stakeOnBehalf([appPoints.address], [stakeAmount], bob.address);

    // Check the sProps balance and staked amounts are all under Bob's ownership
    expect(await sPropsToken.balanceOf(bob.address)).to.eq(stakeAmount);
    expect(await appPointsStaking.balanceOf(bob.address)).to.eq(stakeAmount);
    expect(await propsAppStaking.balanceOf(appPoints.address)).to.eq(stakeAmount);
    expect(await propsUserStaking.balanceOf(bob.address)).to.eq(stakeAmount);

    // Check Alice has nothing staked
    expect(await sPropsToken.balanceOf(alice.address)).to.eq(bn(0));
    expect(await appPointsStaking.balanceOf(alice.address)).to.eq(bn(0));
    expect(await propsUserStaking.balanceOf(alice.address)).to.eq(bn(0));
  });

  it("stake on behalf with permit", async () => {
    const [appPoints, appPointsStaking] = await deployApp();

    const stakeAmount = expandTo18Decimals(100);

    // Sign the permit
    const permitMessage = {
      owner: alice.address,
      spender: propsProtocol.address,
      value: stakeAmount.toString(),
      nonce: (await propsToken.nonces(alice.address)).toString(),
      deadline: (await now()).add(daysToTimestamp(1)).toString(),
    };

    const permitData = {
      domain: {
        chainId: (await ethers.provider.getNetwork()).chainId,
        name: await propsToken.name(),
        verifyingContract: propsToken.address,
        version: "1",
      },
      message: permitMessage,
      primaryType: "Permit" as const,
      types: {
        EIP712Domain: [
          { name: "name", type: "string" },
          { name: "version", type: "string" },
          { name: "chainId", type: "uint256" },
          { name: "verifyingContract", type: "address" },
        ],
        Permit: [
          { name: "owner", type: "address" },
          { name: "spender", type: "address" },
          { name: "value", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      },
    };

    const permitSig = ethUtil.fromRpcSig(
      sigUtil.signTypedData_v4(getPrivateKey(alice.address), { data: permitData })
    );

    // Stake on behalf with permit
    await propsToken.connect(deployer).transfer(alice.address, stakeAmount);
    await propsProtocol
      .connect(alice)
      .stakeOnBehalfWithPermit(
        [appPoints.address],
        [stakeAmount],
        bob.address,
        permitMessage.owner,
        permitMessage.spender,
        permitMessage.value,
        permitMessage.deadline,
        permitSig.v,
        permitSig.r,
        permitSig.s
      );

    // Check the sProps balance and staked amounts are all under Bob's ownership
    expect(await sPropsToken.balanceOf(bob.address)).to.eq(stakeAmount);
    expect(await appPointsStaking.balanceOf(bob.address)).to.eq(stakeAmount);
    expect(await propsAppStaking.balanceOf(appPoints.address)).to.eq(stakeAmount);
    expect(await propsUserStaking.balanceOf(bob.address)).to.eq(stakeAmount);

    // Check that Alice has nothing staked
    expect(await sPropsToken.balanceOf(alice.address)).to.eq(bn(0));
    expect(await appPointsStaking.balanceOf(alice.address)).to.eq(bn(0));
    expect(await propsUserStaking.balanceOf(alice.address)).to.eq(bn(0));
  });

  it("basic rewards staking adjustment to a single app", async () => {
    const [appPoints, appPointsStaking] = await deployApp();

    // Stake
    const principalStakeAmount = expandTo18Decimals(100);
    await propsToken.connect(deployer).transfer(alice.address, principalStakeAmount);
    await propsToken.connect(alice).approve(propsProtocol.address, principalStakeAmount);
    await propsProtocol.connect(alice).stake([appPoints.address], [principalStakeAmount]);

    // Fast-forward a few days
    await mineBlock((await now()).add(daysToTimestamp(10)));

    // Claim user Props rewards
    await propsProtocol.connect(alice).claimUserPropsRewards();

    const escrowedRewards = await propsProtocol.rewardsEscrow(alice.address);
    const rewardsStakeAmount = escrowedRewards.div(2);

    // Stake the escrowed rewards
    await propsProtocol.connect(alice).stakeRewards([appPoints.address], [rewardsStakeAmount]);

    // Check the sProps balance and staked amounts
    expect(await sPropsToken.balanceOf(alice.address)).to.eq(
      principalStakeAmount.add(rewardsStakeAmount)
    );
    expect(await appPointsStaking.balanceOf(alice.address)).to.eq(
      principalStakeAmount.add(rewardsStakeAmount)
    );
    expect(await propsAppStaking.balanceOf(appPoints.address)).to.eq(
      principalStakeAmount.add(rewardsStakeAmount)
    );
    expect(await propsUserStaking.balanceOf(alice.address)).to.eq(
      principalStakeAmount.add(rewardsStakeAmount)
    );

    // Check the escrow
    expect(await propsProtocol.rewardsEscrow(alice.address)).to.eq(
      escrowedRewards.sub(rewardsStakeAmount)
    );

    // Rebalance
    const rebalanceTime = await getTxTimestamp(
      await propsProtocol
        .connect(alice)
        .stakeRewards([appPoints.address], [rewardsStakeAmount.mul(-1)])
    );

    // Check the sProps balance and staked amounts
    expect(await sPropsToken.balanceOf(alice.address)).to.eq(principalStakeAmount);
    expect(await appPointsStaking.balanceOf(alice.address)).to.eq(principalStakeAmount);
    expect(await propsAppStaking.balanceOf(appPoints.address)).to.eq(principalStakeAmount);
    expect(await propsUserStaking.balanceOf(alice.address)).to.eq(principalStakeAmount);

    // Check the escrow
    expect(await propsProtocol.rewardsEscrow(alice.address)).to.eq(escrowedRewards);
    expect(await propsProtocol.rewardsEscrowUnlock(alice.address)).to.eq(
      rebalanceTime.add(await propsProtocol.rewardsEscrowCooldown())
    );
  });

  it("rewards staking adjustment to two apps", async () => {
    const [appPoints1, appPointsStaking1] = await deployApp();
    const [appPoints2, appPointsStaking2] = await deployApp();

    // Stake
    const [principalStakeAmount1, principalStakeAmount2] = [
      expandTo18Decimals(50),
      expandTo18Decimals(70),
    ];
    await propsToken.connect(deployer).transfer(alice.address, expandTo18Decimals(120));
    await propsToken.connect(alice).approve(propsProtocol.address, expandTo18Decimals(120));
    await propsProtocol
      .connect(alice)
      .stake(
        [appPoints1.address, appPoints2.address],
        [principalStakeAmount1, principalStakeAmount2]
      );

    // Fast-forward a few days
    await mineBlock((await now()).add(daysToTimestamp(10)));

    // Claim user Props rewards
    await propsProtocol.connect(alice).claimUserPropsRewards();

    const escrowedRewards = await propsProtocol.rewardsEscrow(alice.address);
    const [rewardsStakeAmount1, rewardsStakeAmount2] = [
      escrowedRewards.div(2), // Just some amount residing in the escrow
      escrowedRewards.div(4), // Just some amount residing in the escrow
    ];

    // Stake the escrowed rewards
    const tx = await propsProtocol
      .connect(alice)
      .stakeRewards(
        [appPoints1.address, appPoints2.address],
        [rewardsStakeAmount1, rewardsStakeAmount2]
      );

    // Check that `Staked` events got emitted
    const [
      [app1, account1, amount1, rewards1],
      [app2, account2, amount2, rewards2],
    ] = await getEvents(await tx.wait(), "Staked(address,address,int256,bool)", "PropsProtocol");
    expect(app1).to.eq(appPoints1.address);
    expect(account1).to.eq(alice.address);
    expect(amount1).to.eq(rewardsStakeAmount1);
    expect(rewards1).to.eq(true);
    expect(app2).to.eq(appPoints2.address);
    expect(account2).to.eq(alice.address);
    expect(amount2).to.eq(rewardsStakeAmount2);
    expect(rewards2).to.eq(true);

    // Check the escrow
    expect(await propsProtocol.rewardsEscrow(alice.address)).to.eq(
      escrowedRewards.sub(rewardsStakeAmount1.add(rewardsStakeAmount2))
    );

    // Rebalance: withdraw all rewards staked to appPoints1 and stake half of that to appPoints2
    const rebalanceTime = await getTxTimestamp(
      await propsProtocol
        .connect(alice)
        .stakeRewards(
          [appPoints1.address, appPoints2.address],
          [rewardsStakeAmount1.mul(-1), rewardsStakeAmount1.div(2)]
        )
    );

    // Check the sProps balance and staked amounts
    expect(await sPropsToken.balanceOf(alice.address)).to.eq(
      principalStakeAmount1
        .add(principalStakeAmount2)
        .add(rewardsStakeAmount2)
        .add(rewardsStakeAmount1.div(2))
    );
    expect(await appPointsStaking1.balanceOf(alice.address)).to.eq(principalStakeAmount1);
    expect(await appPointsStaking2.balanceOf(alice.address)).to.eq(
      principalStakeAmount2.add(rewardsStakeAmount2).add(rewardsStakeAmount1.div(2))
    );
    expect(await propsAppStaking.balanceOf(appPoints1.address)).to.eq(principalStakeAmount1);
    expect(await propsAppStaking.balanceOf(appPoints2.address)).to.eq(
      principalStakeAmount2.add(rewardsStakeAmount2).add(rewardsStakeAmount1.div(2))
    );
    expect(await propsUserStaking.balanceOf(alice.address)).to.eq(
      principalStakeAmount1
        .add(principalStakeAmount2)
        .add(rewardsStakeAmount2)
        .add(rewardsStakeAmount1.div(2))
    );

    // Check the escrow
    expect(await propsProtocol.rewardsEscrow(alice.address)).to.eq(
      escrowedRewards.sub(rewardsStakeAmount2.add(rewardsStakeAmount1.div(2)))
    );
    expect(await propsProtocol.rewardsEscrowUnlock(alice.address)).to.eq(
      rebalanceTime.add(await propsProtocol.rewardsEscrowCooldown())
    );
  });

  it("stake to blacklisted apps", async () => {
    const [appPoints1] = await deployApp();
    const [appPoints2] = await deployApp();

    // Stake
    await propsToken.connect(deployer).transfer(alice.address, expandTo18Decimals(1000));
    await propsToken.connect(alice).approve(propsProtocol.address, expandTo18Decimals(1000));
    await propsProtocol
      .connect(alice)
      .stake(
        [appPoints1.address, appPoints2.address],
        [expandTo18Decimals(50), expandTo18Decimals(100)]
      );

    // Blacklist app
    await propsProtocol.connect(controller).updateAppWhitelist(appPoints1.address, false);

    // No additional stake can be added to blacklisted apps
    await expect(
      propsProtocol.connect(alice).stake([appPoints1.address], [expandTo18Decimals(50)])
    ).to.be.revertedWith("App not whitelisted");

    // However, withdraws are still available
    expect(
      await propsProtocol
        .connect(alice)
        .stake(
          [appPoints1.address, appPoints2.address],
          [expandTo18Decimals(-50), expandTo18Decimals(30)]
        )
    );
  });

  it("multiple users staking to the same app", async () => {
    const [appPoints] = await deployApp();

    // Stake with Alice
    const aliceStakeAmount = expandTo18Decimals(50);
    await propsToken.connect(deployer).transfer(alice.address, aliceStakeAmount);
    await propsToken.connect(alice).approve(propsProtocol.address, aliceStakeAmount);
    await propsProtocol.connect(alice).stake([appPoints.address], [aliceStakeAmount]);

    // Stake with Bob
    const bobStakeAmount = expandTo18Decimals(100);
    await propsToken.connect(deployer).transfer(bob.address, bobStakeAmount);
    await propsToken.connect(bob).approve(propsProtocol.address, bobStakeAmount);
    await propsProtocol.connect(bob).stake([appPoints.address], [bobStakeAmount]);

    // Check the app's total staked amount
    expect(await propsAppStaking.balanceOf(appPoints.address)).to.eq(
      aliceStakeAmount.add(bobStakeAmount)
    );

    // Withdraw with Alice
    await propsProtocol.connect(alice).stake([appPoints.address], [aliceStakeAmount.mul(-1)]);

    // Check the app's total staked amount
    expect(await propsAppStaking.balanceOf(appPoints.address)).to.eq(bobStakeAmount);
  });

  it("claim app points rewards", async () => {
    const [appPoints, appPointsStaking] = await deployApp();

    // Distribute app points rewards
    const rewardAmount = expandTo18Decimals(10000);
    await appPoints.connect(appOwner).transfer(appPointsStaking.address, rewardAmount);
    await appPointsStaking.connect(appOwner).notifyRewardAmount(rewardAmount);

    // Stake
    const stakeAmount = expandTo18Decimals(100);
    await propsToken.connect(deployer).transfer(alice.address, stakeAmount);
    await propsToken.connect(alice).approve(propsProtocol.address, stakeAmount);
    await propsProtocol.connect(alice).stake([appPoints.address], [stakeAmount]);

    // Fast-forward a few days
    await mineBlock((await now()).add(daysToTimestamp(10)));

    const earned = await appPointsStaking.earned(alice.address);

    // Claim app points rewards
    await propsProtocol.connect(alice).claimAppPointsRewards([appPoints.address]);

    // Ensure results are within .01%
    const inWallet = await appPoints.balanceOf(alice.address);
    expect(earned.sub(inWallet).abs().lte(inWallet.div(10000))).to.be.true;
  });

  it("claim app Props rewards", async () => {
    const [appPoints] = await deployApp();

    // Stake
    const stakeAmount = expandTo18Decimals(100);
    await propsToken.connect(deployer).transfer(alice.address, stakeAmount);
    await propsToken.connect(alice).approve(propsProtocol.address, stakeAmount);
    await propsProtocol.connect(alice).stake([appPoints.address], [stakeAmount]);

    // Fast-forward a few days
    await mineBlock((await now()).add(daysToTimestamp(10)));

    // Only the app owner can claim app Props rewards
    await expect(
      propsProtocol.connect(alice).claimAppPropsRewards(appPoints.address, alice.address)
    ).to.be.revertedWith("Unauthorized");

    const earned = await propsAppStaking.earned(appPoints.address);

    // Claim app Props rewards
    await propsProtocol.connect(appOwner).claimAppPropsRewards(appPoints.address, appOwner.address);

    // Make sure the app owner has no rProps in their wallet
    expect(await rPropsToken.balanceOf(appOwner.address)).to.eq(bn(0));

    // Ensure results are within .01%
    const inWallet = await propsToken.balanceOf(appOwner.address);
    expect(earned.sub(inWallet).abs().lte(inWallet.div(10000))).to.be.true;
  });

  it("directly stake app Props rewards", async () => {
    const [appPoints, appPointsStaking] = await deployApp();

    // Stake
    const stakeAmount = expandTo18Decimals(100);
    await propsToken.connect(deployer).transfer(alice.address, expandTo18Decimals(120));
    await propsToken.connect(alice).approve(propsProtocol.address, expandTo18Decimals(120));
    await propsProtocol.connect(alice).stake([appPoints.address], [stakeAmount]);

    // Fast-forward a few days
    await mineBlock((await now()).add(daysToTimestamp(10)));

    // Only the app owner can claim app Props rewards and stake
    await expect(
      propsProtocol.connect(alice).claimAppPropsRewardsAndStake(appPoints.address)
    ).to.be.revertedWith("Unauthorized");

    // Claiming and staking is possible only for whitelisted apps
    await propsProtocol.connect(controller).updateAppWhitelist(appPoints.address, false);
    await expect(
      propsProtocol.connect(appOwner).claimAppPropsRewardsAndStake(appPoints.address)
    ).to.be.revertedWith("App not whitelisted");
    await propsProtocol.connect(controller).updateAppWhitelist(appPoints.address, true);

    const earned = await propsAppStaking.earned(appPoints.address);

    // Claim and directly stake app Props rewards
    await propsProtocol.connect(appOwner).claimAppPropsRewardsAndStake(appPoints.address);

    // Check the amounts staked to the app points staking contracts (ensure results are within .01%)
    const appPointsStakingAmount1 = await appPointsStaking.balanceOf(appOwner.address);
    expect(appPointsStakingAmount1.sub(earned).abs().lte(appPointsStakingAmount1.div(10000))).to.be
      .true;
  });

  it("claim user Props rewards", async () => {
    const [appPoints] = await deployApp();

    // Stake
    const stakeAmount = expandTo18Decimals(100);
    await propsToken.connect(deployer).transfer(alice.address, stakeAmount);
    await propsToken.connect(alice).approve(propsProtocol.address, stakeAmount);
    await propsProtocol.connect(alice).stake([appPoints.address], [stakeAmount]);

    // Fast-forward a few days
    await mineBlock((await now()).add(daysToTimestamp(10)));

    const earned = await propsUserStaking.earned(alice.address);

    // Claim user Props rewards
    const tx = await propsProtocol.connect(alice).claimUserPropsRewards();

    // Check that `RewardsEscrowUpdated` event got emitted
    const [[account, lockedAmount, unlockTime]] = await getEvents(
      await tx.wait(),
      "RewardsEscrowUpdated(address,uint256,uint256)",
      "PropsProtocol"
    );
    expect(account).to.eq(alice.address);
    // Ensure results are within .01%
    expect(lockedAmount.sub(earned).abs().lte(earned.div(10000))).to.be.true;
    expect(unlockTime).to.eq(
      (await getTxTimestamp(tx)).add(await propsProtocol.rewardsEscrowCooldown())
    );

    // Make sure the user Props rewards weren't directly transferred to their wallet
    expect(await propsToken.balanceOf(alice.address)).to.eq(bn(0));

    // Make sure the user has no rProps in their wallet
    expect(await rPropsToken.balanceOf(alice.address)).to.eq(bn(0));

    // Ensure results are within .01%
    const inEscrow = await propsProtocol.rewardsEscrow(alice.address);
    expect(earned.sub(inEscrow).abs().lte(inEscrow.div(10000))).to.be.true;
  });

  it("directly stake user Props rewards", async () => {
    const [appPoints1, appPointsStaking1] = await deployApp();
    const [appPoints2, appPointsStaking2] = await deployApp();

    // Stake
    const [stakeAmount1, stakeAmount2] = [expandTo18Decimals(50), expandTo18Decimals(70)];
    await propsToken.connect(deployer).transfer(alice.address, expandTo18Decimals(120));
    await propsToken.connect(alice).approve(propsProtocol.address, expandTo18Decimals(120));
    await propsProtocol
      .connect(alice)
      .stake([appPoints1.address, appPoints2.address], [stakeAmount1, stakeAmount2]);

    // Fast-forward a few days
    await mineBlock((await now()).add(daysToTimestamp(10)));

    const earned = await propsUserStaking.earned(alice.address);

    // Invalid staking percentages
    await expect(
      propsProtocol
        .connect(alice)
        .claimUserPropsRewardsAndStake([appPoints1.address, appPoints2.address], [bn(100000)])
    ).to.be.revertedWith("Invalid input");
    await expect(
      propsProtocol
        .connect(alice)
        .claimUserPropsRewardsAndStake(
          [appPoints1.address, appPoints2.address],
          [bn(100000), bn(10)]
        )
    ).to.be.revertedWith("Invalid percentages");

    // Claim and directly stake user Props rewards
    await propsProtocol
      .connect(alice)
      .claimUserPropsRewardsAndStake(
        [appPoints1.address, appPoints2.address],
        [bn(300000), bn(700000)]
      );

    // Make sure the user has no rProps in their wallet
    expect(await rPropsToken.balanceOf(alice.address)).to.eq(bn(0));

    // Check the sProps balance (ensure results are within .01%)
    const sPropsBalance = await sPropsToken.balanceOf(alice.address);
    const localSPropsBalance = stakeAmount1.add(stakeAmount2).add(earned);
    expect(sPropsBalance.sub(localSPropsBalance).abs().lte(sPropsBalance.div(10000))).to.be.true;

    // Check the amounts staked to the app points staking contracts (ensure results are within .01%)
    const appPointsStakingAmount1 = await appPointsStaking1.balanceOf(alice.address);
    const localAppPointsStakingAmount1 = stakeAmount1.add(earned.mul(30).div(100));

    expect(
      appPointsStakingAmount1
        .sub(localAppPointsStakingAmount1)
        .abs()
        .lte(appPointsStakingAmount1.div(10000))
    ).to.be.true;

    const appPointsStakingAmount2 = await appPointsStaking2.balanceOf(alice.address);
    const localAppPointsStakingAmount2 = stakeAmount2.add(earned.mul(70).div(100));

    expect(
      appPointsStakingAmount2
        .sub(localAppPointsStakingAmount2)
        .abs()
        .lte(appPointsStakingAmount2.div(10000))
    ).to.be.true;

    // Check the escrow
    expect(await propsProtocol.rewardsEscrow(alice.address)).to.eq(bn(0));
  });

  it("unlock user Props rewards", async () => {
    const [appPoints] = await deployApp();

    // Stake
    const stakeAmount = expandTo18Decimals(100);
    await propsToken.connect(deployer).transfer(alice.address, stakeAmount);
    await propsToken.connect(alice).approve(propsProtocol.address, stakeAmount);
    await propsProtocol.connect(alice).stake([appPoints.address], [stakeAmount]);

    // Fast-forward a few days
    await mineBlock((await now()).add(daysToTimestamp(10)));

    const earned = await propsUserStaking.earned(alice.address);

    // Claim user Props rewards
    await propsProtocol.connect(alice).claimUserPropsRewards();

    // Try to unlock the escrowed rewards
    await expect(propsProtocol.connect(alice).unlockUserPropsRewards()).to.be.revertedWith(
      "Rewards locked"
    );

    // Fast-forward until after the rewards cooldown period
    await mineBlock((await propsProtocol.rewardsEscrowUnlock(alice.address)).add(1));

    // Unlock the escrowed rewards
    await propsProtocol.connect(alice).unlockUserPropsRewards();

    // Make sure the user has no rProps in their wallet
    expect(await rPropsToken.balanceOf(alice.address)).to.eq(bn(0));

    // Ensure results are within .01%
    const inWallet = await propsToken.balanceOf(alice.address);
    expect(earned.sub(inWallet).abs().lte(inWallet.div(10000))).to.be.true;
  });

  it("update the rewards escrow cooldown", async () => {
    const [appPoints] = await deployApp();

    // Stake
    const stakeAmount = expandTo18Decimals(100);
    await propsToken.connect(deployer).transfer(alice.address, stakeAmount);
    await propsToken.connect(alice).approve(propsProtocol.address, stakeAmount);
    await propsProtocol.connect(alice).stake([appPoints.address], [stakeAmount]);

    // Fast-forward a few days to accumulate some staking rewards
    await mineBlock((await now()).add(daysToTimestamp(10)));

    const initialRewardsEscrowCooldown = await propsProtocol.rewardsEscrowCooldown();

    // Claim user Props rewards
    const firstClaimTime = await getTxTimestamp(
      await propsProtocol.connect(alice).claimUserPropsRewards()
    );

    // Update the rewards escrow cooldown
    await propsProtocol.connect(controller).changeRewardsEscrowCooldown(daysToTimestamp(1000));

    const updatedRewardsEscrowCooldown = await propsProtocol.rewardsEscrowCooldown();
    expect(updatedRewardsEscrowCooldown).to.eq(daysToTimestamp(1000));

    // The Props claimed before the cooldown update are still claimable based on the old cooldown
    expect(await propsProtocol.rewardsEscrowUnlock(alice.address)).to.eq(
      firstClaimTime.add(initialRewardsEscrowCooldown)
    );

    // Claim user Props rewards
    const secondClaimTime = await getTxTimestamp(
      await propsProtocol.connect(alice).claimUserPropsRewards()
    );

    // However, further claims will unlock all rewards under the new cooldown
    expect(await propsProtocol.rewardsEscrowUnlock(alice.address)).to.eq(
      secondClaimTime.add(updatedRewardsEscrowCooldown)
    );
  });

  it("delegatee can adjust existing stake", async () => {
    const [appPoints1, appPointsStaking1] = await deployApp();
    const [appPoints2, appPointsStaking2] = await deployApp();

    // Stake
    const [stakeAmount1, stakeAmount2] = [expandTo18Decimals(50), expandTo18Decimals(70)];
    await propsToken.connect(deployer).transfer(alice.address, expandTo18Decimals(120));
    await propsToken.connect(alice).approve(propsProtocol.address, expandTo18Decimals(120));
    await propsProtocol
      .connect(alice)
      .stake([appPoints1.address, appPoints2.address], [stakeAmount1, stakeAmount2]);

    // Delegate staking rights
    const tx = await propsProtocol.connect(alice).delegate(bob.address);

    // Check that `DelegateChanged` event got emitted
    const [[delegator, delegatee]] = await getEvents(
      await tx.wait(),
      "DelegateChanged(address,address)",
      "PropsProtocol"
    );
    expect(delegator).to.eq(alice.address);
    expect(delegatee).to.eq(bob.address);

    // Delegatee is able to adjust the delegator's stakes
    const [adjustment1, adjustment2] = [expandTo18Decimals(20), expandTo18Decimals(-20)];
    await propsProtocol
      .connect(bob)
      .stakeAsDelegate(
        [appPoints1.address, appPoints2.address],
        [adjustment1, adjustment2],
        alice.address
      );

    // Check that the delegator's stakes were correctly adjusted
    expect(await appPointsStaking1.balanceOf(alice.address)).to.eq(expandTo18Decimals(70));
    expect(await appPointsStaking2.balanceOf(alice.address)).to.eq(expandTo18Decimals(50));

    // Delegatee cannot stake more than the existing stake
    await expect(
      propsProtocol
        .connect(bob)
        .stakeAsDelegate(
          [appPoints1.address, appPoints2.address],
          [expandTo18Decimals(30), expandTo18Decimals(-20)],
          alice.address
        )
    ).to.be.revertedWith("Unauthorized");

    // Delegatee cannot trigger any withdraws
    await expect(
      propsProtocol
        .connect(bob)
        .stakeAsDelegate([appPoints1.address, appPoints2.address], [bn(10), bn(-20)], alice.address)
    ).to.be.revertedWith("Unauthorized");

    // Remove delegation
    await propsProtocol.connect(alice).delegate(alice.address);
    await expect(
      propsProtocol
        .connect(bob)
        .stakeAsDelegate(
          [appPoints1.address, appPoints2.address],
          [expandTo18Decimals(-10), expandTo18Decimals(10)],
          alice.address
        )
    ).to.be.revertedWith("Unauthorized");
  });

  it("delegatee can adjust existing rewards stake", async () => {
    const [appPoints1, appPointsStaking1] = await deployApp();
    const [appPoints2, appPointsStaking2] = await deployApp();

    // Stake
    const [stakeAmount1, stakeAmount2] = [expandTo18Decimals(50), expandTo18Decimals(70)];
    await propsToken.connect(deployer).transfer(alice.address, expandTo18Decimals(120));
    await propsToken.connect(alice).approve(propsProtocol.address, expandTo18Decimals(120));
    await propsProtocol
      .connect(alice)
      .stake([appPoints1.address, appPoints2.address], [stakeAmount1, stakeAmount2]);

    // Fast-forward a few days
    await mineBlock((await now()).add(daysToTimestamp(10)));

    // Delegate staking rights
    await propsProtocol.connect(alice).delegate(bob.address);

    const earned = await propsUserStaking.earned(alice.address);

    // Claim Props rewards
    await propsProtocol.connect(alice).claimUserPropsRewards();

    // Delegatee is able to adjust the delegator's stakes
    const [adjustment1, adjustment2] = [earned.div(3), earned.div(3)];
    await propsProtocol
      .connect(bob)
      .stakeRewardsAsDelegate(
        [appPoints1.address, appPoints2.address],
        [adjustment1, adjustment2],
        alice.address
      );

    // Check that the delegator's stakes were correctly adjusted
    expect(await appPointsStaking1.balanceOf(alice.address)).to.eq(stakeAmount1.add(adjustment1));
    expect(await appPointsStaking2.balanceOf(alice.address)).to.eq(stakeAmount2.add(adjustment2));

    // Delegatee cannot trigger any withdraws
    await expect(
      propsProtocol
        .connect(bob)
        .stakeRewardsAsDelegate(
          [appPoints1.address, appPoints2.address],
          [earned.div(-3), earned.div(-3)],
          alice.address
        )
    ).to.be.revertedWith("Unauthorized");
  });

  it("delegatee can directly stake delegator's Props rewards", async () => {
    const [appPoints1, appPointsStaking1] = await deployApp();
    const [appPoints2, appPointsStaking2] = await deployApp();

    // Stake
    const [stakeAmount1, stakeAmount2] = [expandTo18Decimals(50), expandTo18Decimals(70)];
    await propsToken.connect(deployer).transfer(alice.address, expandTo18Decimals(120));
    await propsToken.connect(alice).approve(propsProtocol.address, expandTo18Decimals(120));
    await propsProtocol
      .connect(alice)
      .stake([appPoints1.address, appPoints2.address], [stakeAmount1, stakeAmount2]);

    // Fast-forward a few days
    await mineBlock((await now()).add(daysToTimestamp(10)));

    // Delegate staking rights
    await propsProtocol.connect(alice).delegate(bob.address);

    const earned = await propsUserStaking.earned(alice.address);

    // Claim and directly stake user Props rewards
    await propsProtocol
      .connect(bob)
      .claimUserPropsRewardsAndStakeAsDelegate(
        [appPoints1.address, appPoints2.address],
        [bn(300000), bn(700000)],
        alice.address
      );

    // Check the sProps balance (ensure results are within .01%)
    const sPropsBalance = await sPropsToken.balanceOf(alice.address);
    const localSPropsBalance = stakeAmount1.add(stakeAmount2).add(earned);
    expect(sPropsBalance.sub(localSPropsBalance).abs().lte(sPropsBalance.div(10000))).to.be.true;

    // Check the amounts staked to the app points staking contracts (ensure results are within .01%)
    const appPointsStakingAmount1 = await appPointsStaking1.balanceOf(alice.address);
    const localAppPointsStakingAmount1 = stakeAmount1.add(earned.mul(30).div(100));
    expect(
      appPointsStakingAmount1
        .sub(localAppPointsStakingAmount1)
        .abs()
        .lte(appPointsStakingAmount1.div(10000))
    ).to.be.true;

    const appPointsStakingAmount2 = await appPointsStaking2.balanceOf(alice.address);
    const localAppPointsStakingAmount2 = stakeAmount2.add(earned.mul(70).div(100));

    expect(
      appPointsStakingAmount2
        .sub(localAppPointsStakingAmount2)
        .abs()
        .lte(appPointsStakingAmount2.div(10000))
    ).to.be.true;

    // Check the escrow
    expect(await propsProtocol.rewardsEscrow(alice.address)).to.eq(bn(0));
  });

  it("proper permissioning", async () => {
    // Only the controller can set the rewards escrow cooldown
    await expect(
      propsProtocol.connect(alice).changeRewardsEscrowCooldown(bn(10))
    ).to.be.revertedWith("Unauthorized");
    await propsProtocol.connect(controller).changeRewardsEscrowCooldown(bn(10));

    // Only the controller can update the app whitelist
    await expect(
      propsProtocol.connect(alice).updateAppWhitelist(mock.address, true)
    ).to.be.revertedWith("Unauthorized");
    await propsProtocol.connect(controller).updateAppWhitelist(mock.address, true);

    // Either the guardian or the controller can pause/unpause the controller
    await expect(propsProtocol.connect(alice).pause()).to.be.revertedWith("Unauthorized");
    await propsProtocol.connect(guardian).pause();
    await expect(propsProtocol.connect(alice).unpause()).to.be.revertedWith("Unauthorized");
    await propsProtocol.connect(controller).unpause();

    // Only the controller can transfer guardianship
    await expect(
      propsProtocol.connect(guardian).transferGuardianship(mock.address)
    ).to.be.revertedWith("Unauthorized");
    await propsProtocol.connect(controller).transferGuardianship(mock.address);
    await expect(propsProtocol.connect(guardian).pause()).to.be.revertedWith("Unauthorized");
    await propsProtocol.connect(mock).pause();

    // Transfer control
    await propsProtocol.connect(controller).transferControl(mock.address);
    await expect(
      propsProtocol.connect(controller).changeRewardsEscrowCooldown(bn(10))
    ).to.be.revertedWith("Unauthorized");
    await propsProtocol.connect(mock).changeRewardsEscrowCooldown(bn(10));
  });

  it("no user actions are available when paused", async () => {
    const [appPoints] = await deployApp();

    // Prepare staking
    const stakeAmount = expandTo18Decimals(100);
    await propsToken.connect(deployer).transfer(alice.address, stakeAmount);
    await propsToken.connect(alice).approve(propsProtocol.address, stakeAmount);

    // Pause the contract
    await propsProtocol.connect(guardian).pause();

    // No action is available when paused
    await expect(
      propsProtocol.connect(alice).stake([appPoints.address], [stakeAmount])
    ).to.be.revertedWith("Pausable: paused");
    await expect(propsProtocol.connect(alice).delegate(bob.address)).to.be.revertedWith(
      "Pausable: paused"
    );
    await expect(propsProtocol.connect(alice).claimUserPropsRewards()).to.be.revertedWith(
      "Pausable: paused"
    );

    // Unpause the contract
    await propsProtocol.connect(guardian).unpause();

    // Actions are once again available
    await propsProtocol.connect(alice).stake([appPoints.address], [stakeAmount]);
    await propsProtocol.connect(alice).claimUserPropsRewards();
  });

  it("stake via meta-transactions", async () => {
    const [appPoints, appPointsStaking] = await deployApp();
    const stakeAmount = expandTo18Decimals(100);

    const message = {
      from: alice.address,
      nonce: (await propsProtocol.nonces(alice.address)).toNumber(),
      callData: propsProtocol.interface.encodeFunctionData("stake", [
        [appPoints.address],
        [stakeAmount],
      ]),
      deadline: (await now()).add(daysToTimestamp(1)).toString(),
    };

    const metaTransactionData = {
      types: {
        EIP712Domain: [
          { name: "name", type: "string" },
          { name: "version", type: "string" },
          { name: "chainId", type: "uint256" },
          { name: "verifyingContract", type: "address" },
        ],
        MetaTransaction: [
          { name: "nonce", type: "uint256" },
          { name: "from", type: "address" },
          { name: "callData", type: "bytes" },
          { name: "deadline", type: "uint256" },
        ],
      },
      domain: {
        name: "PropsProtocol",
        version: "1",
        verifyingContract: propsProtocol.address,
        chainId: 1,
      },
      primaryType: "MetaTransaction" as const,
      message,
    };

    const metaTransactionSig = ethUtil.fromRpcSig(
      sigUtil.signTypedData_v4(getPrivateKey(alice.address), { data: metaTransactionData })
    );

    // Stake on behalf with permit
    await propsToken.connect(deployer).transfer(alice.address, stakeAmount);
    await propsToken.connect(alice).approve(propsProtocol.address, stakeAmount);
    await propsProtocol
      // Since this is a meta-transaction, anyone is able to relay it
      .connect(bob)
      .executeMetaTransaction(
        message.from,
        message.callData,
        message.deadline,
        metaTransactionSig.v,
        metaTransactionSig.r,
        metaTransactionSig.s
      );

    // Check the sProps balance and staked amounts
    expect(await sPropsToken.balanceOf(alice.address)).to.eq(stakeAmount);
    expect(await appPointsStaking.balanceOf(alice.address)).to.eq(stakeAmount);
    expect(await propsAppStaking.balanceOf(appPoints.address)).to.eq(stakeAmount);
    expect(await propsUserStaking.balanceOf(alice.address)).to.eq(stakeAmount);
  });

  it("cannot re-set initialization parameters", async () => {
    await expect(
      propsProtocol.connect(controller).setAppProxyFactory(mock.address)
    ).to.be.revertedWith("Already set");
    await expect(propsProtocol.connect(controller).setRPropsToken(mock.address)).to.be.revertedWith(
      "Already set"
    );
    await expect(propsProtocol.connect(controller).setSPropsToken(mock.address)).to.be.revertedWith(
      "Already set"
    );
    await expect(
      propsProtocol.connect(controller).setPropsAppStaking(mock.address)
    ).to.be.revertedWith("Already set");
    await expect(
      propsProtocol.connect(controller).setPropsUserStaking(mock.address)
    ).to.be.revertedWith("Already set");
  });

  it("save app", async () => {
    // Only AppProxyFactory can save apps
    await expect(
      propsProtocol.connect(controller).saveApp(mock.address, mock.address)
    ).to.be.revertedWith("Unauthorized");
  });

  it("whitelist updates", async () => {
    const [appPoints] = await deployApp();

    // Stake
    const stakeAmount = expandTo18Decimals(100);
    await propsToken.connect(deployer).transfer(alice.address, stakeAmount);
    await propsToken.connect(alice).approve(propsProtocol.address, stakeAmount);
    await propsProtocol.connect(alice).stake([appPoints.address], [stakeAmount]);

    // Fast-forward a few days to allow accruing rewards
    await mineBlock((await now()).add(daysToTimestamp(10)));

    // Check the sProps were staked on behalf of the app
    expect(await propsAppStaking.balanceOf(appPoints.address)).to.eq(stakeAmount);

    // Blacklist app
    await propsProtocol.connect(controller).updateAppWhitelist(appPoints.address, false);

    // Check that the sProps previously staked on behalf of the app were withdrawn
    expect(await propsAppStaking.balanceOf(appPoints.address)).to.eq(bn(0));

    // However, previously earned app Props rewards can still be claimed
    await propsProtocol.connect(appOwner).claimAppPropsRewards(appPoints.address, appOwner.address);
    expect((await propsToken.balanceOf(appOwner.address)).gt(0)).to.be.true;

    // Unstake half of the initially staked amount to app
    await propsProtocol.connect(alice).stake([appPoints.address], [stakeAmount.div(2).mul(-1)]);

    // Whitelist app
    await propsProtocol.connect(controller).updateAppWhitelist(appPoints.address, true);

    // Check that the sProps previously staked on behalf of the app were re-staked
    expect(await propsAppStaking.balanceOf(appPoints.address)).to.eq(stakeAmount.div(2));
  });

  it("permit and stake within the same transaction", async () => {
    const [appPoints, appPointsStaking] = await deployApp();
    const stakeAmount = expandTo18Decimals(100);

    const message = {
      owner: alice.address,
      spender: propsProtocol.address,
      value: stakeAmount.toString(),
      callTo: propsProtocol.address,
      callData: propsProtocol.interface.encodeFunctionData("stake", [
        [appPoints.address],
        [stakeAmount],
      ]),
      nonce: (await propsToken.nonces(alice.address)).toNumber(),
      deadline: (await now()).add(daysToTimestamp(1)).toString(),
    };

    const permitAndCallData = {
      types: {
        EIP712Domain: [
          { name: "name", type: "string" },
          { name: "version", type: "string" },
          { name: "chainId", type: "uint256" },
          { name: "verifyingContract", type: "address" },
        ],
        PermitAndCall: [
          { name: "owner", type: "address" },
          { name: "spender", type: "address" },
          { name: "value", type: "uint256" },
          { name: "callTo", type: "address" },
          { name: "callData", type: "bytes" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      },
      domain: {
        name: await propsToken.name(),
        version: "1",
        verifyingContract: propsToken.address,
        chainId: (await ethers.provider.getNetwork()).chainId,
      },
      primaryType: "PermitAndCall" as const,
      message,
    };

    const permitAndCallSig = ethUtil.fromRpcSig(
      sigUtil.signTypedData_v4(getPrivateKey(alice.address), { data: permitAndCallData })
    );

    // Permit and stake in a single transaction
    await propsToken.connect(deployer).transfer(alice.address, stakeAmount);
    await propsToken
      // Since this works by checking the signature, the transaction can be relayed by anyone
      .connect(bob)
      .permitAndCall(
        message.owner,
        message.spender,
        message.value,
        message.callTo,
        message.callData,
        message.deadline,
        permitAndCallSig.v,
        permitAndCallSig.r,
        permitAndCallSig.s
      );

    // Check the sProps balance and staked amounts
    expect(await sPropsToken.balanceOf(alice.address)).to.eq(stakeAmount);
    expect(await appPointsStaking.balanceOf(alice.address)).to.eq(stakeAmount);
    expect(await propsAppStaking.balanceOf(appPoints.address)).to.eq(stakeAmount);
    expect(await propsUserStaking.balanceOf(alice.address)).to.eq(stakeAmount);
  });
});
