import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import chai from "chai";
import * as ethUtil from "ethereumjs-util";
import { solidity } from "ethereum-waffle";
import { BigNumber } from "ethers";
import * as sigUtil from "eth-sig-util";
import { ethers } from "hardhat";

import type {
  AppPoints,
  AppProxyFactory,
  PropsProtocol,
  RPropsToken,
  SPropsToken,
  Staking,
  TestPropsToken,
} from "../typechain";
import {
  bn,
  daysToTimestamp,
  deployContract,
  deployContractUpgradeable,
  expandTo18Decimals,
  getEvent,
  getPrivateKey,
  getTxTimestamp,
  mineBlock,
  now,
} from "../utils";

chai.use(solidity);
const { expect } = chai;

describe("PropsProtocol", () => {
  let propsTreasury: SignerWithAddress;
  let appOwner: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;

  let propsToken: TestPropsToken;
  let rPropsToken: RPropsToken;
  let sPropsToken: SPropsToken;
  let propsAppStaking: Staking;
  let propsUserStaking: Staking;
  let appProxyFactory: AppProxyFactory;
  let propsProtocol: PropsProtocol;

  const PROPS_TOKEN_AMOUNT = expandTo18Decimals(100000);

  const APP_POINTS_TOKEN_NAME = "AppPoints";
  const APP_POINTS_TOKEN_SYMBOL = "AppPoints";
  const APP_POINTS_TOKEN_AMOUNT = expandTo18Decimals(100000);

  // Corresponds to 0.0003658 - taken from old Props rewards formula
  // Distributes 12.5% of the remaining rewards pool each year
  const DAILY_REWARDS_EMISSION = bn(3658).mul(1e11);

  const deployApp = async (
    rewardsDistributedPercentage: BigNumber = bn(0)
  ): Promise<[AppPoints, Staking]> => {
    const tx = await appProxyFactory
      .connect(appOwner)
      .deployApp(
        APP_POINTS_TOKEN_NAME,
        APP_POINTS_TOKEN_SYMBOL,
        APP_POINTS_TOKEN_AMOUNT,
        appOwner.address,
        DAILY_REWARDS_EMISSION,
        rewardsDistributedPercentage
      );
    const [appPointsAddress, appPointsStakingAddress] = await getEvent(
      await tx.wait(),
      "AppDeployed(address,address,string,string,address)",
      "AppProxyFactory"
    );

    await propsProtocol.connect(propsTreasury).whitelistApp(appPointsAddress);

    return [
      (await ethers.getContractFactory("AppPoints")).attach(appPointsAddress) as AppPoints,
      (await ethers.getContractFactory("Staking")).attach(appPointsStakingAddress) as Staking,
    ];
  };

  beforeEach(async () => {
    [propsTreasury, appOwner, alice, bob] = await ethers.getSigners();

    propsToken = await deployContractUpgradeable("TestPropsToken", propsTreasury, [
      PROPS_TOKEN_AMOUNT,
    ]);

    propsProtocol = await deployContractUpgradeable("PropsProtocol", propsTreasury, [
      propsTreasury.address,
      propsTreasury.address,
      propsToken.address,
    ]);

    rPropsToken = await deployContractUpgradeable("RPropsToken", propsTreasury, [
      propsProtocol.address,
      propsToken.address,
    ]);

    sPropsToken = await deployContractUpgradeable("SPropsToken", propsTreasury, [
      propsProtocol.address,
    ]);

    propsAppStaking = await deployContractUpgradeable("Staking", propsTreasury, [
      propsProtocol.address,
      rPropsToken.address,
      rPropsToken.address,
      propsProtocol.address,
      DAILY_REWARDS_EMISSION,
    ]);

    propsUserStaking = await deployContractUpgradeable("Staking", propsTreasury, [
      propsProtocol.address,
      rPropsToken.address,
      rPropsToken.address,
      propsProtocol.address,
      DAILY_REWARDS_EMISSION,
    ]);

    const appPointsLogic = await deployContract<AppPoints>("AppPoints", propsTreasury);
    const appPointsStakingLogic = await deployContract<Staking>("Staking", propsTreasury);

    appProxyFactory = await deployContractUpgradeable("AppProxyFactory", propsTreasury, [
      propsTreasury.address,
      propsProtocol.address,
      propsTreasury.address,
      propsToken.address,
      appPointsLogic.address,
      appPointsStakingLogic.address,
    ]);

    // The rProps token contract is allowed to mint new Props
    await propsToken.connect(propsTreasury).setMinter(rPropsToken.address);

    // Initialize all needed fields on the controller
    await propsProtocol.connect(propsTreasury).setAppProxyFactory(appProxyFactory.address);
    await propsProtocol.connect(propsTreasury).setRPropsToken(rPropsToken.address);
    await propsProtocol.connect(propsTreasury).setSPropsToken(sPropsToken.address);
    await propsProtocol.connect(propsTreasury).setPropsAppStaking(propsAppStaking.address);
    await propsProtocol.connect(propsTreasury).setPropsUserStaking(propsUserStaking.address);

    // Distribute the rProps rewards to the sProps staking contracts
    await propsProtocol.connect(propsTreasury).distributePropsRewards(bn(800000), bn(200000));
  });

  it("sProps are not transferrable", async () => {
    const [appPoints] = await deployApp();

    // Stake
    const stakeAmount = expandTo18Decimals(100);
    await propsToken.connect(propsTreasury).transfer(alice.address, stakeAmount);
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
    await propsToken.connect(propsTreasury).transfer(alice.address, stakeAmount);
    await propsToken.connect(alice).approve(propsProtocol.address, stakeAmount);
    await propsProtocol.connect(alice).stake([appPoints.address], [stakeAmount]);

    // Check the sProps balance and staked amounts
    expect(await sPropsToken.balanceOf(alice.address)).to.eq(expandTo18Decimals(100));
    expect(await appPointsStaking.balanceOf(alice.address)).to.eq(expandTo18Decimals(100));
    expect(await propsAppStaking.balanceOf(appPoints.address)).to.eq(expandTo18Decimals(100));
    expect(await propsUserStaking.balanceOf(alice.address)).to.eq(expandTo18Decimals(100));

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
    await propsToken.connect(propsTreasury).transfer(alice.address, expandTo18Decimals(150));
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
    await propsToken.connect(propsTreasury).transfer(alice.address, expandTo18Decimals(20));
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
    await propsToken.connect(propsTreasury).transfer(alice.address, expandTo18Decimals(230));
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

  it("properly handles an invalid staking adjustment", async () => {
    const [appPoints] = await deployApp();

    // No approval to transfer tokens
    await expect(
      propsProtocol.connect(alice).stake([appPoints.address], [expandTo18Decimals(100)])
    ).to.be.revertedWith("ERC20: transfer amount exceeds balance");

    // Stake amount underflow
    await expect(
      propsProtocol.connect(alice).stake([appPoints.address], [expandTo18Decimals(-100)])
    ).to.be.revertedWith("SafeMath: subtraction overflow");
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
    await propsToken.connect(propsTreasury).transfer(alice.address, stakeAmount);
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

  // it("stake with permit by signature", async () => {
  //   const [appPoints, appPointsStaking] = await deployApp();

  //   const stakeAmount = expandTo18Decimals(100);

  //   // Sign the permit
  //   const permitMessage = {
  //     owner: alice.address,
  //     spender: propsProtocol.address,
  //     value: stakeAmount.toString(),
  //     nonce: (await propsToken.nonces(alice.address)).toString(),
  //     deadline: (await now()).add(daysToTimestamp(1)).toString(),
  //   };

  //   const permitData = {
  //     domain: {
  //       chainId: (await ethers.provider.getNetwork()).chainId,
  //       name: await propsToken.name(),
  //       verifyingContract: propsToken.address,
  //       version: "1",
  //     },
  //     message: permitMessage,
  //     primaryType: "Permit" as const,
  //     types: {
  //       EIP712Domain: [
  //         { name: "name", type: "string" },
  //         { name: "version", type: "string" },
  //         { name: "chainId", type: "uint256" },
  //         { name: "verifyingContract", type: "address" },
  //       ],
  //       Permit: [
  //         { name: "owner", type: "address" },
  //         { name: "spender", type: "address" },
  //         { name: "value", type: "uint256" },
  //         { name: "nonce", type: "uint256" },
  //         { name: "deadline", type: "uint256" },
  //       ],
  //     },
  //   };

  //   const permitSig = ethUtil.fromRpcSig(
  //     sigUtil.signTypedData_v4(getPrivateKey(alice.address), { data: permitData })
  //   );

  //   // Sign the stake
  //   const stakeMessage = {
  //     signer: alice.address,
  //     apps: [appPoints.address],
  //     amounts: [stakeAmount.toString()],
  //     nonce: (await propsToken.nonces(alice.address)).toString(),
  //     deadline: (await now()).add(daysToTimestamp(1)).toString(),
  //   };

  //   const stakeData = {
  //     domain: {
  //       chainId: (await ethers.provider.getNetwork()).chainId,
  //       name: "PropsProtocol",
  //       verifyingContract: propsProtocol.address,
  //       version: "1",
  //     },
  //     message: stakeMessage,
  //     primaryType: "Stake" as const,
  //     types: {
  //       EIP712Domain: [
  //         { name: "name", type: "string" },
  //         { name: "version", type: "string" },
  //         { name: "chainId", type: "uint256" },
  //         { name: "verifyingContract", type: "address" },
  //       ],
  //       Stake: [
  //         { name: "signer", type: "address" },
  //         { name: "apps", type: "address[]" },
  //         { name: "amounts", type: "int256[]" },
  //         { name: "nonce", type: "uint256" },
  //         { name: "deadline", type: "uint256" },
  //       ],
  //     },
  //   };

  //   const stakeSig = ethUtil.fromRpcSig(
  //     sigUtil.signTypedData_v4(getPrivateKey(alice.address), { data: stakeData })
  //   );

  //   // Stake with permit by signature
  //   await propsToken.connect(propsTreasury).transfer(alice.address, stakeAmount);
  //   await propsProtocol
  //     // Since this is a stake by signature, we don't necessarily need Alice to send the transaction
  //     .connect(propsTreasury)
  //     .stakeWithPermitBySig(
  //       stakeMessage.signer,
  //       stakeMessage.apps,
  //       stakeMessage.amounts,
  //       stakeMessage.deadline,
  //       stakeSig.v,
  //       stakeSig.r,
  //       stakeSig.s,
  //       permitMessage.owner,
  //       permitMessage.spender,
  //       permitMessage.value,
  //       permitMessage.deadline,
  //       permitSig.v,
  //       permitSig.r,
  //       permitSig.s
  //     );

  //   // Check the sProps balance and staked amounts
  //   expect(await sPropsToken.balanceOf(alice.address)).to.eq(stakeAmount);
  //   expect(await appPointsStaking.balanceOf(alice.address)).to.eq(stakeAmount);
  //   expect(await propsAppStaking.balanceOf(appPoints.address)).to.eq(stakeAmount);
  //   expect(await propsUserStaking.balanceOf(alice.address)).to.eq(stakeAmount);
  // });

  it("stake on behalf", async () => {
    const [appPoints, appPointsStaking] = await deployApp();

    // Stake
    const stakeAmount = expandTo18Decimals(100);
    await propsToken.connect(propsTreasury).transfer(alice.address, stakeAmount);
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

  // it("stake on behalf by signature", async () => {
  //   const [appPoints, appPointsStaking] = await deployApp();

  //   const stakeAmount = expandTo18Decimals(100);

  //   // Sign the stake
  //   const stakeMessage = {
  //     signer: alice.address,
  //     apps: [appPoints.address],
  //     amounts: [stakeAmount.toString()],
  //     account: bob.address,
  //     nonce: (await propsToken.nonces(alice.address)).toString(),
  //     deadline: (await now()).add(daysToTimestamp(1)).toString(),
  //   };

  //   const stakeData = {
  //     domain: {
  //       chainId: (await ethers.provider.getNetwork()).chainId,
  //       name: "PropsProtocol",
  //       verifyingContract: propsProtocol.address,
  //       version: "1",
  //     },
  //     message: stakeMessage,
  //     primaryType: "StakeOnBehalf" as const,
  //     types: {
  //       EIP712Domain: [
  //         { name: "name", type: "string" },
  //         { name: "version", type: "string" },
  //         { name: "chainId", type: "uint256" },
  //         { name: "verifyingContract", type: "address" },
  //       ],
  //       StakeOnBehalf: [
  //         { name: "signer", type: "address" },
  //         { name: "apps", type: "address[]" },
  //         { name: "amounts", type: "uint256[]" },
  //         { name: "account", type: "address" },
  //         { name: "nonce", type: "uint256" },
  //         { name: "deadline", type: "uint256" },
  //       ],
  //     },
  //   };

  //   const stakeSig = ethUtil.fromRpcSig(
  //     sigUtil.signTypedData_v4(getPrivateKey(alice.address), { data: stakeData })
  //   );

  //   // Stake
  //   await propsToken.connect(propsTreasury).transfer(alice.address, stakeAmount);
  //   await propsToken.connect(alice).approve(propsProtocol.address, stakeAmount);
  //   await propsProtocol
  //     // Since this is a stake by signature, we don't necessarily need Alice to send the transaction
  //     .connect(propsTreasury)
  //     .stakeOnBehalfBySig(
  //       stakeMessage.signer,
  //       stakeMessage.apps,
  //       stakeMessage.amounts,
  //       stakeMessage.account,
  //       stakeMessage.deadline,
  //       stakeSig.v,
  //       stakeSig.r,
  //       stakeSig.s
  //     );

  //   // Check the sProps balance and staked amounts are all under Bob's ownership
  //   expect(await sPropsToken.balanceOf(bob.address)).to.eq(stakeAmount);
  //   expect(await appPointsStaking.balanceOf(bob.address)).to.eq(stakeAmount);
  //   expect(await propsAppStaking.balanceOf(appPoints.address)).to.eq(stakeAmount);
  //   expect(await propsUserStaking.balanceOf(bob.address)).to.eq(stakeAmount);

  //   // Check Alice has nothing staked
  //   expect(await sPropsToken.balanceOf(alice.address)).to.eq(bn(0));
  //   expect(await appPointsStaking.balanceOf(alice.address)).to.eq(bn(0));
  //   expect(await propsUserStaking.balanceOf(alice.address)).to.eq(bn(0));
  // });

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
    await propsToken.connect(propsTreasury).transfer(alice.address, stakeAmount);
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

  // it("stake on behalf with permit by signature", async () => {
  //   const [appPoints, appPointsStaking] = await deployApp();

  //   const stakeAmount = expandTo18Decimals(100);

  //   // Sign the permit
  //   const permitMessage = {
  //     owner: alice.address,
  //     spender: propsProtocol.address,
  //     value: stakeAmount.toString(),
  //     nonce: (await propsToken.nonces(alice.address)).toString(),
  //     deadline: (await now()).add(daysToTimestamp(1)).toString(),
  //   };

  //   const permitData = {
  //     domain: {
  //       chainId: (await ethers.provider.getNetwork()).chainId,
  //       name: await propsToken.name(),
  //       verifyingContract: propsToken.address,
  //       version: "1",
  //     },
  //     message: permitMessage,
  //     primaryType: "Permit" as const,
  //     types: {
  //       EIP712Domain: [
  //         { name: "name", type: "string" },
  //         { name: "version", type: "string" },
  //         { name: "chainId", type: "uint256" },
  //         { name: "verifyingContract", type: "address" },
  //       ],
  //       Permit: [
  //         { name: "owner", type: "address" },
  //         { name: "spender", type: "address" },
  //         { name: "value", type: "uint256" },
  //         { name: "nonce", type: "uint256" },
  //         { name: "deadline", type: "uint256" },
  //       ],
  //     },
  //   };

  //   const permitSig = ethUtil.fromRpcSig(
  //     sigUtil.signTypedData_v4(getPrivateKey(alice.address), { data: permitData })
  //   );

  //   // Sign the stake
  //   const stakeMessage = {
  //     signer: alice.address,
  //     apps: [appPoints.address],
  //     amounts: [stakeAmount.toString()],
  //     account: bob.address,
  //     nonce: (await propsToken.nonces(alice.address)).toString(),
  //     deadline: (await now()).add(daysToTimestamp(1)).toString(),
  //   };

  //   const stakeData = {
  //     domain: {
  //       chainId: (await ethers.provider.getNetwork()).chainId,
  //       name: "PropsProtocol",
  //       verifyingContract: propsProtocol.address,
  //       version: "1",
  //     },
  //     message: stakeMessage,
  //     primaryType: "StakeOnBehalf" as const,
  //     types: {
  //       EIP712Domain: [
  //         { name: "name", type: "string" },
  //         { name: "version", type: "string" },
  //         { name: "chainId", type: "uint256" },
  //         { name: "verifyingContract", type: "address" },
  //       ],
  //       StakeOnBehalf: [
  //         { name: "signer", type: "address" },
  //         { name: "apps", type: "address[]" },
  //         { name: "amounts", type: "uint256[]" },
  //         { name: "account", type: "address" },
  //         { name: "nonce", type: "uint256" },
  //         { name: "deadline", type: "uint256" },
  //       ],
  //     },
  //   };

  //   const stakeSig = ethUtil.fromRpcSig(
  //     sigUtil.signTypedData_v4(getPrivateKey(alice.address), { data: stakeData })
  //   );

  //   // Stake on behalf with permit
  //   await propsToken.connect(propsTreasury).transfer(alice.address, stakeAmount);
  //   await propsProtocol
  //     .connect(alice)
  //     .stakeOnBehalfWithPermitBySig(
  //       stakeMessage.signer,
  //       stakeMessage.apps,
  //       stakeMessage.amounts,
  //       stakeMessage.account,
  //       stakeMessage.deadline,
  //       stakeSig.v,
  //       stakeSig.r,
  //       stakeSig.s,
  //       permitMessage.owner,
  //       permitMessage.spender,
  //       permitMessage.value,
  //       permitMessage.deadline,
  //       permitSig.v,
  //       permitSig.r,
  //       permitSig.s
  //     );

  //   // Check the sProps balance and staked amounts are all under Bob's ownership
  //   expect(await sPropsToken.balanceOf(bob.address)).to.eq(stakeAmount);
  //   expect(await appPointsStaking.balanceOf(bob.address)).to.eq(stakeAmount);
  //   expect(await propsAppStaking.balanceOf(appPoints.address)).to.eq(stakeAmount);
  //   expect(await propsUserStaking.balanceOf(bob.address)).to.eq(stakeAmount);

  //   // Check that Alice has nothing staked
  //   expect(await sPropsToken.balanceOf(alice.address)).to.eq(bn(0));
  //   expect(await appPointsStaking.balanceOf(alice.address)).to.eq(bn(0));
  //   expect(await propsUserStaking.balanceOf(alice.address)).to.eq(bn(0));
  // });

  it("basic rewards staking adjustment to a single app", async () => {
    const [appPoints, appPointsStaking] = await deployApp();

    // Stake
    const principalStakeAmount = expandTo18Decimals(100);
    await propsToken.connect(propsTreasury).transfer(alice.address, principalStakeAmount);
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
    await propsToken.connect(propsTreasury).transfer(alice.address, expandTo18Decimals(120));
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
      escrowedRewards.div(2),
      escrowedRewards.div(4),
    ];

    // Stake the escrowed rewards
    await propsProtocol
      .connect(alice)
      .stakeRewards(
        [appPoints1.address, appPoints2.address],
        [rewardsStakeAmount1, rewardsStakeAmount2]
      );

    // Check the escrow
    expect(await propsProtocol.rewardsEscrow(alice.address)).to.eq(
      escrowedRewards.sub(rewardsStakeAmount1.add(rewardsStakeAmount2))
    );

    // Rebalance
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

  it("claim app points rewards", async () => {
    const [appPoints, appPointsStaking] = await deployApp();

    // Distribute app points rewards
    const rewardAmount = expandTo18Decimals(10000);
    await appPoints.connect(appOwner).transfer(appPointsStaking.address, rewardAmount);
    await appPointsStaking.connect(appOwner).notifyRewardAmount(rewardAmount);

    // Stake
    const stakeAmount = expandTo18Decimals(100);
    await propsToken.connect(propsTreasury).transfer(alice.address, stakeAmount);
    await propsToken.connect(alice).approve(propsProtocol.address, stakeAmount);
    await propsProtocol.connect(alice).stake([appPoints.address], [stakeAmount]);

    // Fast-forward a few days
    await mineBlock((await now()).add(daysToTimestamp(10)));

    const earned = await appPointsStaking.earned(alice.address);

    // Claim app points rewards
    await propsProtocol.connect(alice).claimAppPointsRewards(appPoints.address);

    // Ensure results are within .01%
    const inWallet = await appPoints.balanceOf(alice.address);
    expect(earned.sub(inWallet).abs().lte(inWallet.div(10000))).to.be.true;
  });

  it("claim app Props rewards", async () => {
    const [appPoints] = await deployApp();

    // Stake
    const stakeAmount = expandTo18Decimals(100);
    await propsToken.connect(propsTreasury).transfer(alice.address, stakeAmount);
    await propsToken.connect(alice).approve(propsProtocol.address, stakeAmount);
    await propsProtocol.connect(alice).stake([appPoints.address], [stakeAmount]);

    // Fast-forward a few days
    await mineBlock((await now()).add(daysToTimestamp(10)));

    // Only the app owner can claim app Props rewards
    await expect(
      propsProtocol.connect(alice).claimAppPropsRewards(appPoints.address)
    ).to.be.revertedWith("Unauthorized");

    const earned = await propsAppStaking.earned(appPoints.address);

    // Claim app Props rewards
    await propsProtocol.connect(appOwner).claimAppPropsRewards(appPoints.address);

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
    await propsToken.connect(propsTreasury).transfer(alice.address, expandTo18Decimals(120));
    await propsToken.connect(alice).approve(propsProtocol.address, expandTo18Decimals(120));
    await propsProtocol.connect(alice).stake([appPoints.address], [stakeAmount]);

    // Fast-forward a few days
    await mineBlock((await now()).add(daysToTimestamp(10)));

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
    await propsToken.connect(propsTreasury).transfer(alice.address, stakeAmount);
    await propsToken.connect(alice).approve(propsProtocol.address, stakeAmount);
    await propsProtocol.connect(alice).stake([appPoints.address], [stakeAmount]);

    // Fast-forward a few days
    await mineBlock((await now()).add(daysToTimestamp(10)));

    const earned = await propsUserStaking.earned(alice.address);

    // Claim user Props rewards
    await propsProtocol.connect(alice).claimUserPropsRewards();

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
    await propsToken.connect(propsTreasury).transfer(alice.address, expandTo18Decimals(120));
    await propsToken.connect(alice).approve(propsProtocol.address, expandTo18Decimals(120));
    await propsProtocol
      .connect(alice)
      .stake([appPoints1.address, appPoints2.address], [stakeAmount1, stakeAmount2]);

    // Fast-forward a few days
    await mineBlock((await now()).add(daysToTimestamp(10)));

    const earned = await propsUserStaking.earned(alice.address);

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
    await propsToken.connect(propsTreasury).transfer(alice.address, stakeAmount);
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

  it("delegatee can adjust existing stake", async () => {
    const [appPoints1, appPointsStaking1] = await deployApp();
    const [appPoints2, appPointsStaking2] = await deployApp();

    // Stake
    const [stakeAmount1, stakeAmount2] = [expandTo18Decimals(50), expandTo18Decimals(70)];
    await propsToken.connect(propsTreasury).transfer(alice.address, expandTo18Decimals(120));
    await propsToken.connect(alice).approve(propsProtocol.address, expandTo18Decimals(120));
    await propsProtocol
      .connect(alice)
      .stake([appPoints1.address, appPoints2.address], [stakeAmount1, stakeAmount2]);

    // Delegate staking rights
    await propsProtocol.connect(alice).delegate(bob.address);

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
  });

  it("delegatee can adjust existing rewards stake", async () => {
    const [appPoints1, appPointsStaking1] = await deployApp();
    const [appPoints2, appPointsStaking2] = await deployApp();

    // Stake
    const [stakeAmount1, stakeAmount2] = [expandTo18Decimals(50), expandTo18Decimals(70)];
    await propsToken.connect(propsTreasury).transfer(alice.address, expandTo18Decimals(120));
    await propsToken.connect(alice).approve(propsProtocol.address, expandTo18Decimals(120));
    await propsProtocol
      .connect(alice)
      .stake([appPoints1.address, appPoints2.address], [stakeAmount1, stakeAmount2]);

    // Fast-forward a few days
    await mineBlock((await now()).add(daysToTimestamp(10)));

    // Delegate staking rights
    await propsProtocol.connect(alice).delegate(bob.address);

    const earned = await propsUserStaking.balanceOf(alice.address);

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
    await propsToken.connect(propsTreasury).transfer(alice.address, expandTo18Decimals(120));
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
    // Only the owner can set the rewards escrow cooldown
    await expect(
      propsProtocol.connect(alice).changeRewardsEscrowCooldown(bn(10))
    ).to.be.revertedWith("Unauthorized");
    expect(await propsProtocol.connect(propsTreasury).changeRewardsEscrowCooldown(bn(10)));

    const mockAddress = bob.address;

    // Only the owner can whitelist apps
    await expect(propsProtocol.connect(alice).whitelistApp(mockAddress)).to.be.revertedWith(
      "Unauthorized"
    );
    expect(await propsProtocol.connect(propsTreasury).whitelistApp(mockAddress));

    // Only the owner can blacklist apps
    await expect(propsProtocol.connect(alice).blacklistApp(mockAddress)).to.be.revertedWith(
      "Unauthorized"
    );
    expect(await propsProtocol.connect(propsTreasury).blacklistApp(mockAddress));

    // Only the guardian can pause the controller
    await expect(propsProtocol.connect(alice).pause()).to.be.revertedWith("Unauthorized");
    expect(await propsProtocol.connect(propsTreasury).pause());
  });

  it("no user actions are available when paused", async () => {
    const [appPoints] = await deployApp();

    // Prepare staking
    const stakeAmount = expandTo18Decimals(100);
    await propsToken.connect(propsTreasury).transfer(alice.address, stakeAmount);
    await propsToken.connect(alice).approve(propsProtocol.address, stakeAmount);

    // Pause the contract
    await propsProtocol.connect(propsTreasury).pause();

    // No action is available when paused
    await expect(
      propsProtocol.connect(alice).stake([appPoints.address], [stakeAmount])
    ).to.be.revertedWith("Pausable: paused");
    await expect(propsProtocol.connect(alice).claimUserPropsRewards()).to.be.revertedWith(
      "Pausable: paused"
    );

    // Unpause the contract
    await propsProtocol.connect(propsTreasury).unpause();

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
      functionSignature: propsProtocol.interface.encodeFunctionData("stake", [
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
          { name: "functionSignature", type: "bytes" },
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
    await propsToken.connect(propsTreasury).transfer(alice.address, stakeAmount);
    await propsToken.connect(alice).approve(propsProtocol.address, stakeAmount);
    await propsProtocol
      // Since this is a meta-transaction, anyone is able to relay it
      .connect(bob)
      .executeMetaTransaction(
        message.from,
        message.functionSignature,
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
});
