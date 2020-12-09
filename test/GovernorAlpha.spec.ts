import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { BigNumber, ContractTransaction } from "ethers";
import { ethers } from "hardhat";

import { GovernorAlpha } from "../typechain/GovernorAlpha";
import { RewardsEscrow } from "../typechain/RewardsEscrow";
import { SPropsToken } from "../typechain/SPropsToken";
import { Timelock } from "../typechain/Timelock";
import {
  bn,
  daysToTimestamp,
  deployContract,
  encodeParameters,
  expandTo18Decimals,
  getEvent,
  getFutureAddress,
  mineBlock,
  mineBlocks
} from "./utils";

chai.use(solidity);
const { expect } = chai;

describe("GovernorAlpha", () => {
  let deployer: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;
  
  let rewardsEscrow: RewardsEscrow;
  let sProps: SPropsToken;
  let timelock: Timelock;
  let governorAlpha: GovernorAlpha;

  const REWARDS_ESCROW_LOCK_DURATION = bn(100);

  const SPROPS_TOKEN_SUPPLY = expandTo18Decimals(1000);

  const TIMELOCK_DELAY = daysToTimestamp(3);

  const GOVERNANCE_VOTING_DELAY = bn(1);
  const GOVERNANCE_VOTING_PERIOD = bn(5);

  beforeEach(async () => {
    [deployer, alice, bob, ] = await ethers.getSigners();

    const sPropsAddress = getFutureAddress(
      deployer.address,
      (await deployer.getTransactionCount()) + 1
    );

    rewardsEscrow = await deployContract(
      "RewardsEscrow",
      deployer,
      sPropsAddress, // _rewardsToken
      REWARDS_ESCROW_LOCK_DURATION // _lockDuration
    );

    sProps = await deployContract(
      "SPropsToken",
      deployer,
      SPROPS_TOKEN_SUPPLY,  // _supply
      rewardsEscrow.address // _rewardsEscrow
    );

    const governorAlphaAddress = getFutureAddress(
      deployer.address,
      (await deployer.getTransactionCount()) + 1
    );

    timelock = await deployContract(
      "Timelock",
      deployer,
      governorAlphaAddress, // admin_
      TIMELOCK_DELAY   // delay_
    );

    governorAlpha = await deployContract(
      "GovernorAlpha",
      deployer,
      timelock.address, // timelock_
      sProps.address,   // sProps_
      GOVERNANCE_VOTING_DELAY, // votingDelay_
      GOVERNANCE_VOTING_PERIOD // votingPeriod_
    );
  });

  it("basic governance flow", async () => {
    // Delegate voting power
    await sProps.connect(deployer).delegate(alice.address);

    let tx: ContractTransaction;

    // Create proposal and check that it succeeded
    tx = await governorAlpha.connect(alice).propose(
      // targets: the addresses of the contracts to call
      [timelock.address],
      // values: optionally send Ether along with the calls
      [0],
      // signatures: the signatures of the functions to call
      ["setPendingAdmin(address)"],
      // calldatas: the parameters for each function call
      [encodeParameters(["address"], [alice.address])],
      // description: description of the proposal
      "Change Timelock's admin"
    );
    const [
      proposalId,
      proposer,
      ,,,,
      proposalStartBlock,
      proposalEndBlock,
    ] = await getEvent(
      await tx.wait(),
      "ProposalCreated(uint256,address,address[],uint256[],string[],bytes[],uint256,uint256,string)",
      "GovernorAlpha"
    );
    expect(proposer).to.eq(alice.address);

    // Fast forward until the start of the voting period
    await mineBlocks((await governorAlpha.votingDelay()).toNumber());

    let voter: string;
    let support: boolean;
    let votes: BigNumber;

    // Vote on proposal, from an account that has no voting power
    tx = await governorAlpha.connect(bob).castVote(proposalId, true);
    [voter, , support, votes] = await getEvent(
      await tx.wait(),
      "VoteCast(address,uint256,bool,uint256)",
      "GovernorAlpha"
    );
    expect(voter).to.eq(bob.address);
    expect(support).to.eq(true);
    expect(votes).to.eq(await sProps.getPriorVotes(bob.address, proposalStartBlock));

    // Vote once again on proposal, this time from an account that has voting power
    tx = await governorAlpha.connect(alice).castVote(proposalId, true);
    [voter, , support, votes] = await getEvent(
      await tx.wait(),
      "VoteCast(address,uint256,bool,uint256)",
      "GovernorAlpha"
    );
    expect(voter).to.eq(alice.address);
    expect(support).to.eq(true);
    expect(votes).to.eq(await sProps.getPriorVotes(alice.address, proposalStartBlock));

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
    expect(await timelock.pendingAdmin()).to.eq(alice.address);
  });
});
