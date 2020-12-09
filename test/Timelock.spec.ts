import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { BigNumber, BigNumberish } from "ethers";
import { ethers } from "hardhat";

import { Timelock } from "../typechain/Timelock";
import {
  bn,
  daysToTimestamp,
  deployContract,
  encodeParameters,
  mineBlock,
  now
} from "./utils";

chai.use(solidity);
const { expect } = chai;

// Interface for a timelocked transaction
interface TimelockTx {
  target: string;
  value: BigNumberish;
  signature: string;
  data: string;
  eta: BigNumber;
};

// Utility to allow for easily executing any transaction-related function
const execute = (
  fn: (
    target: string,
    value: BigNumberish,
    signature: string,
    data: string,
    eta: BigNumberish
  ) => Promise<any>,
  tx: TimelockTx
) => fn(tx.target, tx.value, tx.signature, tx.data, tx.eta);

describe("Timelock", () => {
  let deployer: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;
  
  let timelock: Timelock;

  const TIMELOCK_DELAY = daysToTimestamp(3);

  beforeEach(async () => {
    [deployer, alice, bob, ] = await ethers.getSigners();

    timelock = await deployContract(
      "Timelock",
      deployer,
      alice.address, // admin_
      TIMELOCK_DELAY // delay_
    );
  });

  it("properly handles queueing transactions", async () => {
    const timelockTx: TimelockTx = {
      target: timelock.address,
      value: 0,
      signature: "setPendingAdmin(address)",
      data: encodeParameters(["address"], [bob.address]),
      eta: (await now()).add(TIMELOCK_DELAY).add(daysToTimestamp(1))
    };

    // Only the admin can queue transactions
    await expect(
      execute(timelock.connect(bob).queueTransaction, timelockTx)
    ).to.be.revertedWith("Timelock::queueTransaction: Call must come from admin.");

    // The admin can queue transactions
    await execute(timelock.connect(alice).queueTransaction, timelockTx);
  });

  it("properly handles cancelling transactions", async () => {
    const timelockTx: TimelockTx = {
      target: timelock.address,
      value: 0,
      signature: "setPendingAdmin(address)",
      data: encodeParameters(["address"], [bob.address]),
      eta: (await now()).add(TIMELOCK_DELAY).add(daysToTimestamp(1))
    };

    // Queue transaction
    await execute(timelock.connect(alice).queueTransaction, timelockTx)

    // Only the admin can cancel transactions
    await expect(
      execute(timelock.connect(bob).cancelTransaction, timelockTx)
    ).to.be.revertedWith("Timelock::cancelTransaction: Call must come from admin.");

    // The admin can cancel transactions
    await execute(timelock.connect(alice).cancelTransaction, timelockTx);

    // Cannot execute a cancelled transaction
    await expect(
      execute(timelock.connect(alice).executeTransaction, timelockTx)
    ).to.be.revertedWith("Timelock::executeTransaction: Transaction hasn't been queued.");
  });

  it("properly handles executing transactions", async () => {
    const newDelay = TIMELOCK_DELAY.add(1);
    const timelockTx: TimelockTx = {
      target: timelock.address,
      value: 0,
      signature: "setDelay(uint256)",
      data: encodeParameters(["uint256"], [newDelay]),
      eta: (await now()).add(TIMELOCK_DELAY).add(daysToTimestamp(1))
    };

    // Queue transaction
    await execute(timelock.connect(alice).queueTransaction, timelockTx)

    // Fast forward until after the transaction's timelock
    await mineBlock(timelockTx.eta.add(1));

    // Only the admin can execute transactions
    await expect(
      execute(timelock.connect(bob).executeTransaction, timelockTx)
    ).to.be.revertedWith("Timelock::executeTransaction: Call must come from admin.");

    // The admin can execute transactions
    await execute(timelock.connect(alice).executeTransaction, timelockTx);

    // The transaction was indeed executed
    expect(await timelock.delay()).to.eq(newDelay);
  });

  it("properly time locks transactions", async () => {
    const timelockTx: TimelockTx = {
      target: timelock.address,
      value: 0,
      signature: "setDelay(uint256)",
      data: encodeParameters(["uint256"], [TIMELOCK_DELAY.add(1)]),
      eta: bn(0)
    };

    // The transaction's eta must satisfy the Timelock's execution delay
    await expect(
      execute(timelock.connect(alice).queueTransaction, timelockTx)
    ).to.be.revertedWith("Timelock::queueTransaction: Estimated execution block must satisfy delay.");

    // Set a valid eta and queue the transaction
    timelockTx.eta = (await now()).add(TIMELOCK_DELAY).add(daysToTimestamp(1));
    await execute(timelock.connect(alice).queueTransaction, timelockTx);

    // Cannot execute transactions that are under time lock
    await expect(
      execute(timelock.connect(alice).executeTransaction, timelockTx)
    ).to.be.revertedWith("Timelock::executeTransaction: Transaction hasn't surpassed time lock.");

    // Fast forward until after the grace period for executing the transaction
    await mineBlock(timelockTx.eta.add(await timelock.GRACE_PERIOD()).add(1));

    // Cannot execute transactions that have surpassed the execution period
    await expect(
      execute(timelock.connect(alice).executeTransaction, timelockTx)
    ).to.be.revertedWith("Timelock::executeTransaction: Transaction is stale.");
  });
});
