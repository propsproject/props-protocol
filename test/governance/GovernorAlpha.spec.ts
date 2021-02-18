import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { BigNumber, ContractTransaction } from "ethers";
import { ethers } from "hardhat";

import type {
  AppPointsL2,
  AppProxyFactoryL2,
  GovernorAlpha,
  PropsProtocol,
  SPropsToken,
  Staking,
  TestPropsToken,
  Timelock,
} from "../../typechain";
import {
  bn,
  daysToTimestamp,
  deployContract,
  deployContractUpgradeable,
  encodeParameters,
  expandTo18Decimals,
  getEvent,
  mineBlock,
  mineBlocks,
} from "../../utils";

chai.use(solidity);
const { expect } = chai;

describe("GovernorAlpha", () => {
  let deployer: SignerWithAddress;
  let controller: SignerWithAddress;
  let guardian: SignerWithAddress;
  let treasury: SignerWithAddress;
  let appProxyFactoryBridge: SignerWithAddress;
  let appOwner: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;

  let propsToken: TestPropsToken;
  let sPropsToken: SPropsToken;
  let appProxyFactory: AppProxyFactoryL2;
  let propsProtocol: PropsProtocol;
  let timelock: Timelock;
  let governorAlpha: GovernorAlpha;

  const PROPS_TOKEN_AMOUNT = expandTo18Decimals(1000);
  const APP_POINTS_TOKEN_NAME = "AppPoints";
  const APP_POINTS_TOKEN_SYMBOL = "AppPoints";
  const APP_POINTS_TOKEN_AMOUNT = expandTo18Decimals(100000);
  // Corresponds to 0.0003658 - taken from old Props rewards formula
  // Distributes 12.5% of the remaining rewards pool each year
  const DAILY_REWARDS_EMISSION = bn(3658).mul(1e11);
  const TIMELOCK_DELAY = daysToTimestamp(3);
  const GOVERNANCE_VOTING_DELAY = bn(1);
  const GOVERNANCE_VOTING_PERIOD = bn(5);

  const deployApp = async (): Promise<[AppPointsL2, Staking]> => {
    const tx = await appProxyFactory
      .connect(appProxyFactoryBridge)
      .deployApp(
        "0x0000000000000000000000000000000000000000",
        APP_POINTS_TOKEN_NAME,
        APP_POINTS_TOKEN_SYMBOL,
        appOwner.address,
        DAILY_REWARDS_EMISSION
      );
    const [, appPointsAddress, appPointsStakingAddress] = await getEvent(
      await tx.wait(),
      "AppDeployed(address,address,address,string,string,address)",
      "AppProxyFactoryL2"
    );

    const appPoints = (await ethers.getContractFactory("AppPointsL2")).attach(
      appPointsAddress
    ) as AppPointsL2;

    // Mint to the app owner (workaround for moving app points tokens across the bridge)
    await appPoints.connect(appOwner).mint(appOwner.address, APP_POINTS_TOKEN_AMOUNT);

    await propsProtocol.connect(controller).whitelistApp(appPointsAddress);

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
      treasury,
      appProxyFactoryBridge,
      appOwner,
      alice,
      bob,
    ] = await ethers.getSigners();

    propsToken = await deployContractUpgradeable("TestPropsToken", deployer, PROPS_TOKEN_AMOUNT);

    propsProtocol = await deployContractUpgradeable(
      "PropsProtocol",
      deployer,
      controller.address,
      guardian.address,
      propsToken.address
    );

    const rPropsToken = await deployContractUpgradeable(
      "RPropsToken",
      deployer,
      propsProtocol.address,
      propsToken.address
    );

    sPropsToken = await deployContractUpgradeable("SPropsToken", deployer, propsProtocol.address);

    const propsAppStaking = await deployContractUpgradeable(
      "Staking",
      deployer,
      propsProtocol.address,
      rPropsToken.address,
      rPropsToken.address,
      DAILY_REWARDS_EMISSION
    );

    const propsUserStaking = await deployContractUpgradeable(
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
      treasury.address,
      propsToken.address,
      appPointsLogic.address,
      appPointsStakingLogic.address
    );

    // Set needed parameters
    await propsToken.connect(deployer).addMinter(rPropsToken.address);
    await appProxyFactory
      .connect(controller)
      .setAppProxyFactoryBridge(appProxyFactoryBridge.address);
    await propsProtocol.connect(controller).setAppProxyFactory(appProxyFactory.address);
    await propsProtocol.connect(controller).setRPropsToken(rPropsToken.address);
    await propsProtocol.connect(controller).setSPropsToken(sPropsToken.address);
    await propsProtocol.connect(controller).setPropsAppStaking(propsAppStaking.address);
    await propsProtocol.connect(controller).setPropsUserStaking(propsUserStaking.address);

    // Distribute the rProps rewards to the sProps staking contracts
    await propsProtocol.connect(controller).distributePropsRewards(bn(800000), bn(200000));

    const governorAlphaAddress = ethers.utils.getContractAddress({
      from: deployer.address,
      nonce: (await deployer.getTransactionCount()) + 1,
    });

    timelock = await deployContract("Timelock", deployer, governorAlphaAddress, TIMELOCK_DELAY);

    governorAlpha = await deployContract(
      "GovernorAlpha",
      deployer,
      timelock.address,
      sPropsToken.address,
      GOVERNANCE_VOTING_DELAY,
      GOVERNANCE_VOTING_PERIOD
    );
  });

  it("basic governance flow", async () => {
    const [appPoints] = await deployApp();

    // Stake and get sProps
    const stakeAmount = expandTo18Decimals(100);
    await propsToken.connect(deployer).transfer(alice.address, stakeAmount);
    await propsToken.connect(alice).approve(propsProtocol.address, stakeAmount);
    await propsProtocol.connect(alice).stake([appPoints.address], [stakeAmount]);

    expect(await sPropsToken.balanceOf(alice.address)).to.eq(stakeAmount);

    // Delegate voting power
    await sPropsToken.connect(alice).delegate(bob.address);

    let tx: ContractTransaction;

    // Create proposal and check that it succeeded
    tx = await governorAlpha.connect(bob).propose(
      // targets: the addresses of the contracts to call
      [timelock.address],
      // values: optionally send Ether along with the calls
      [0],
      // signatures: the signatures of the functions to call
      ["setPendingAdmin(address)"],
      // calldatas: the parameters for each function call
      [encodeParameters(["address"], [bob.address])],
      // description: description of the proposal
      "Change Timelock's admin"
    );
    const [proposalId, proposer, , , , , proposalStartBlock, proposalEndBlock] = await getEvent(
      await tx.wait(),
      "ProposalCreated(uint256,address,address[],uint256[],string[],bytes[],uint256,uint256,string)",
      "GovernorAlpha"
    );
    expect(proposer).to.eq(bob.address);

    // Fast forward until the start of the voting period
    await mineBlocks((await governorAlpha.votingDelay()).toNumber());

    let voter: string;
    let support: boolean;
    let votes: BigNumber;

    // Vote on proposal, from an account that has no voting power
    tx = await governorAlpha.connect(alice).castVote(proposalId, true);
    [voter, , support, votes] = await getEvent(
      await tx.wait(),
      "VoteCast(address,uint256,bool,uint256)",
      "GovernorAlpha"
    );
    expect(voter).to.eq(alice.address);
    expect(support).to.eq(true);
    expect(votes).to.eq(bn(0));

    // Vote once again on proposal, this time from an account that has voting power
    tx = await governorAlpha.connect(bob).castVote(proposalId, true);
    [voter, , support, votes] = await getEvent(
      await tx.wait(),
      "VoteCast(address,uint256,bool,uint256)",
      "GovernorAlpha"
    );
    expect(voter).to.eq(bob.address);
    expect(support).to.eq(true);
    expect(votes).to.eq(stakeAmount);

    // Fast forward until the start of the voting period
    await mineBlocks(proposalEndBlock - proposalStartBlock + 1);

    // Try to execute the proposal and check that it fails: the proposal needs to be queued first
    await expect(governorAlpha.execute(proposalId)).to.be.reverted;

    // Queue proposal for execution
    tx = await governorAlpha.queue(proposalId);
    const [, eta] = await getEvent(
      await tx.wait(),
      "ProposalQueued(uint256,uint256)",
      "GovernorAlpha"
    );

    // Try to execute the proposal and check that it fails: still under time lock
    await expect(governorAlpha.execute(proposalId)).to.be.reverted;

    // Fast forward until after the proposal time lock
    await mineBlock(eta.add(1));

    // Execute the proposal and check that its actions were successfully performed
    await governorAlpha.execute(proposalId);
    expect(await timelock.pendingAdmin()).to.eq(bob.address);
  });
});
