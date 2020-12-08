import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { BigNumber, ContractTransaction } from "ethers";
import { ethers } from "hardhat";

import { GovernorAlpha } from "../typechain/GovernorAlpha";
import { SProps } from "../typechain/SProps";
import { Timelock } from "../typechain/Timelock";
import {
  bn,
  daysToTimestamp,
  deployContract,
  encodeParameters,
  getDirectEvent,
  getFutureContractAddress,
  mineBlock,
  now
} from "./utils";

chai.use(solidity);
const { expect } = chai;

const TIMELOCK_DELAY = daysToTimestamp(3);
const GOVERNANCE_VOTING_PERIOD = bn(5);

const PROPOSAL_CREATED_SIGNATURE = 'ProposalCreated(uint256,address,address[],uint256[],string[],bytes[],uint256,uint256,string)';
const VOTE_CAST_SIGNATURE = 'VoteCast(address,uint256,bool,uint256)';
const PROPOSAL_QUEUED_SIGNATURE = 'ProposalQueued(uint256,uint256)';

describe("GovernorAlpha", () => {
  let signers: SignerWithAddress[];
  
  let sProps: SProps;
  let timelock: Timelock;
  let governorAlpha: GovernorAlpha;

  beforeEach(async () => {
    signers = await ethers.getSigners();

    const nonce = await signers[0].getTransactionCount();
    // Make sure the contracts are deployed in this exact order to keep the same addresses
    const sPropsAddress = getFutureContractAddress(signers[0].address, nonce);
    const timelockAddress = getFutureContractAddress(signers[0].address, nonce + 1);
    const governorAlphaAddress = getFutureContractAddress(signers[0].address, nonce + 2);

    sProps = await deployContract(
      "SProps",
      signers[0],
      signers[0].address, // account
      signers[0].address, // minter_
      (await now()).add(daysToTimestamp(365)) // mintingAllowedAfter_
    );
    timelock = await deployContract(
      "Timelock",
      signers[0],
      governorAlphaAddress, // admin_
      TIMELOCK_DELAY        // delay_
    );
    governorAlpha = await deployContract(
      "GovernorAlpha",
      signers[0],
      timelock.address, // timelock_
      sProps.address,    // sProps_
      GOVERNANCE_VOTING_PERIOD // votingPeriod_
    );
  });

  it("governance flow", async () => {
    // Delegate voting power
    await sProps.connect(signers[0]).delegate(signers[1].address);

    let tx: ContractTransaction;

    // Create proposal and check that it succeeded
    tx = await governorAlpha.connect(signers[1]).propose(
      // targets: the addresses of the contracts to call
      [timelock.address],
      // values: optionally send Ether along the calls
      [0],
      // signatures: the signatures of the functions to call
      ['setPendingAdmin(address)'],
      // calldatas: the parameters for each function call
      [encodeParameters(['address'], [signers[0].address])],
      // description: description of the proposal
      'Change Timelocks admin'
    );
    const [
      proposalId,
      proposer,
      ,,,,
      proposalStartBlock,
      proposalEndBlock,
    ] = getDirectEvent(await tx.wait(), PROPOSAL_CREATED_SIGNATURE);
    expect(proposer).to.eq(signers[1].address);

    // Fast forward until the start of the voting period
    for (let i = 0; i < (await governorAlpha.votingDelay()).toNumber(); i++) {
      await mineBlock();
    }

    let voter: string;
    let support: boolean;
    let votes: BigNumber;

    // Vote on proposal and check that it succeeded, from an account that has no voting power
    tx = await governorAlpha.connect(signers[0]).castVote(proposalId, true);
    [voter, , support, votes] = getDirectEvent(await tx.wait(), VOTE_CAST_SIGNATURE);
    expect(voter).to.eq(signers[0].address);
    expect(support).to.eq(true);
    expect(votes).to.eq(await sProps.getPriorVotes(signers[0].address, proposalStartBlock));

    // Vote once again on proposal, this time from an account that has voting power
    tx = await governorAlpha.connect(signers[1]).castVote(proposalId, true);
    [voter, , support, votes] = getDirectEvent(await tx.wait(), VOTE_CAST_SIGNATURE);
    expect(voter).to.eq(signers[1].address);
    expect(support).to.eq(true);
    expect(votes).to.eq(await sProps.getPriorVotes(signers[1].address, proposalStartBlock));

    // Fast forward until the start of the voting period
    for (let i = 0; i < proposalEndBlock - proposalStartBlock + 1; i++) {
      await mineBlock();
    }

    // Try to execute the proposal and check that it fails: the proposal needs to be queued first
    await expect(governorAlpha.execute(proposalId)).to.be.reverted;

    // Queue proposal for execution
    tx = await governorAlpha.queue(proposalId);
    const [, eta] = getDirectEvent(await tx.wait(), PROPOSAL_QUEUED_SIGNATURE);

    // Try to execute the proposal and check that it fails: still under time lock
    await expect(governorAlpha.execute(proposalId)).to.be.reverted;

    // Fast forward until after the proposal time lock
    await mineBlock(eta.add(1));

    // Execute the proposal and check that its actions were successfully performed
    await governorAlpha.execute(proposalId);
    expect(await timelock.pendingAdmin()).to.eq(signers[0].address);
  });
});
