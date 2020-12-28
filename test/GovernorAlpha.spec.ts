import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { BigNumber, ContractTransaction } from "ethers";
import { ethers } from "hardhat";

import type {
  AppToken,
  PropsController,
  AppTokenStaking,
  GovernorAlpha,
  TestPropsToken,
  Timelock,
} from "../typechain";
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
} from "./utils";

chai.use(solidity);
const { expect } = chai;

describe("GovernorAlpha", () => {
  let governance: SignerWithAddress;
  let appTokenOwner: SignerWithAddress;
  let propsTreasury: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;

  let propsToken: TestPropsToken;
  let propsController: PropsController;
  let timelock: Timelock;
  let governorAlpha: GovernorAlpha;

  const PROPS_TOKEN_AMOUNT = expandTo18Decimals(1000);

  const APP_TOKEN_NAME = "AppToken";
  const APP_TOKEN_SYMBOL = "AppToken";
  const APP_TOKEN_AMOUNT = expandTo18Decimals(1000);

  // Corresponds to 0.0003658 - taken from old Props rewards formula
  // Distributes 12.5% of the remaining rewards pool each year
  const DAILY_REWARDS_EMISSION = bn(3658).mul(1e11);
  const REWARDS_LOCK_DURATION = daysToTimestamp(365);

  const TIMELOCK_DELAY = daysToTimestamp(3);

  const GOVERNANCE_VOTING_DELAY = bn(1);
  const GOVERNANCE_VOTING_PERIOD = bn(5);

  const deployAppToken = async (): Promise<[AppToken, AppTokenStaking]> => {
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

    return [
      (await ethers.getContractFactory("AppToken")).attach(appTokenAddress) as AppToken,
      (await ethers.getContractFactory("AppTokenStaking")).attach(
        appTokenStakingAddress
      ) as AppTokenStaking,
    ];
  };

  beforeEach(async () => {
    [governance, appTokenOwner, propsTreasury, alice, bob] = await ethers.getSigners();

    const appTokenLogic = await deployContract<AppToken>("AppToken", propsTreasury);
    const appTokenStakingLogic = await deployContract<AppTokenStaking>(
      "AppTokenStaking",
      propsTreasury
    );

    propsToken = await deployContractUpgradeable("TestPropsToken", propsTreasury, [
      PROPS_TOKEN_AMOUNT,
    ]);

    const rPropsTokenAddress = ethers.utils.getContractAddress({
      from: propsTreasury.address,
      nonce: (await propsTreasury.getTransactionCount()) + 5,
    });

    const propsControllerAddress = ethers.utils.getContractAddress({
      from: propsTreasury.address,
      nonce: (await propsTreasury.getTransactionCount()) + 8,
    });

    const sPropsAppStaking = await deployContractUpgradeable("SPropsAppStaking", propsTreasury, [
      propsControllerAddress,
      rPropsTokenAddress,
      rPropsTokenAddress,
      DAILY_REWARDS_EMISSION,
    ]);

    const sPropsUserStaking = await deployContractUpgradeable("SPropsUserStaking", propsTreasury, [
      propsControllerAddress,
      rPropsTokenAddress,
      rPropsTokenAddress,
      DAILY_REWARDS_EMISSION,
      REWARDS_LOCK_DURATION,
    ]);

    const rPropsToken = await deployContractUpgradeable("RPropsToken", propsTreasury, [
      propsTreasury.address,
      propsToken.address,
    ]);

    await rPropsToken
      .connect(propsTreasury)
      .distributeRewards(
        sPropsAppStaking.address,
        bn(800000),
        sPropsUserStaking.address,
        bn(200000)
      );

    propsController = await deployContractUpgradeable("PropsController", propsTreasury, [
      propsTreasury.address,
      propsToken.address,
      rPropsToken.address,
      sPropsAppStaking.address,
      sPropsUserStaking.address,
      appTokenLogic.address,
      appTokenStakingLogic.address,
    ]);

    const governorAlphaAddress = ethers.utils.getContractAddress({
      from: governance.address,
      nonce: (await governance.getTransactionCount()) + 1,
    });

    timelock = await deployContract("Timelock", governance, governorAlphaAddress, TIMELOCK_DELAY);

    governorAlpha = await deployContract(
      "GovernorAlpha",
      governance,
      timelock.address,
      propsController.address,
      GOVERNANCE_VOTING_DELAY,
      GOVERNANCE_VOTING_PERIOD
    );
  });

  it("basic governance flow", async () => {
    const [appToken] = await deployAppToken();

    // Stake and get sProps
    const stakeAmount = bn(100);
    await propsToken.connect(propsTreasury).transfer(alice.address, stakeAmount);
    await propsToken.connect(alice).approve(propsController.address, stakeAmount);
    await propsController.connect(alice).stake([appToken.address], [stakeAmount]);

    expect(await propsController.balanceOf(alice.address)).to.eq(stakeAmount);

    // Delegate voting power
    await propsController.connect(alice).delegate(bob.address);

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
    // TODO Change to hardcoded values
    expect(votes).to.eq(await propsController.getPriorVotes(alice.address, proposalStartBlock));

    // Vote once again on proposal, this time from an account that has voting power
    tx = await governorAlpha.connect(bob).castVote(proposalId, true);
    [voter, , support, votes] = await getEvent(
      await tx.wait(),
      "VoteCast(address,uint256,bool,uint256)",
      "GovernorAlpha"
    );
    expect(voter).to.eq(bob.address);
    expect(support).to.eq(true);
    // TODO Change to hardcoded values
    expect(votes).to.eq(await propsController.getPriorVotes(bob.address, proposalStartBlock));

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
