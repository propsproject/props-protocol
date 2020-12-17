import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { BigNumber, BigNumberish } from "ethers";
import { ethers } from "hardhat";

import type { Timelock } from "../typechain";
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
  let admin: SignerWithAddress;
  let alice: SignerWithAddress;
  
  let timelock: Timelock;

  const TIMELOCK_DELAY = daysToTimestamp(3);

  beforeEach(async () => {
    [admin, alice, ] = await ethers.getSigners();

    timelock = await deployContract(
      "Timelock",
      admin,
      admin.address,
      TIMELOCK_DELAY
    );
  });

  it("queue transactions", async () => {
    const timelockTx: TimelockTx = {
      target: timelock.address,
      value: 0,
      signature: "setPendingAdmin(address)",
      data: encodeParameters(["address"], [alice.address]),
      eta: (await now()).add(TIMELOCK_DELAY).add(daysToTimestamp(1))
    };

    // Only the admin can queue transactions
    await expect(
      execute(timelock.connect(alice).queueTransaction, timelockTx)
    ).to.be.revertedWith("Call must come from admin");

    // The admin can queue transactions
    await execute(timelock.connect(admin).queueTransaction, timelockTx);
  });

  it("cancel transactions", async () => {
    const timelockTx: TimelockTx = {
      target: timelock.address,
      value: 0,
      signature: "setPendingAdmin(address)",
      data: encodeParameters(["address"], [alice.address]),
      eta: (await now()).add(TIMELOCK_DELAY).add(daysToTimestamp(1))
    };

    // Queue transaction
    await execute(timelock.connect(admin).queueTransaction, timelockTx)

    // Only the admin can cancel transactions
    await expect(
      execute(timelock.connect(alice).cancelTransaction, timelockTx)
    ).to.be.revertedWith("Call must come from admin");

    // The admin can cancel transactions
    await execute(timelock.connect(admin).cancelTransaction, timelockTx);

    // Cannot execute a cancelled transaction
    await expect(
      execute(timelock.connect(admin).executeTransaction, timelockTx)
    ).to.be.revertedWith("Transaction hasn't been queued");
  });

  it("execute transactions", async () => {
    const newDelay = TIMELOCK_DELAY.add(1);
    const timelockTx: TimelockTx = {
      target: timelock.address,
      value: 0,
      signature: "setDelay(uint256)",
      data: encodeParameters(["uint256"], [newDelay]),
      eta: (await now()).add(TIMELOCK_DELAY).add(daysToTimestamp(1))
    };

    // Queue transaction
    await execute(timelock.connect(admin).queueTransaction, timelockTx)

    // Fast forward until after the transaction's timelock
    await mineBlock(timelockTx.eta.add(1));

    // Only the admin can execute transactions
    await expect(
      execute(timelock.connect(alice).executeTransaction, timelockTx)
    ).to.be.revertedWith("Call must come from admin");

    // The admin can execute transactions
    await execute(timelock.connect(admin).executeTransaction, timelockTx);

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
      execute(timelock.connect(admin).queueTransaction, timelockTx)
    ).to.be.revertedWith("Estimated execution block must satisfy delay");

    // Set a valid eta and queue the transaction
    timelockTx.eta = (await now()).add(TIMELOCK_DELAY).add(daysToTimestamp(1));
    await execute(timelock.connect(admin).queueTransaction, timelockTx);

    // Cannot execute transactions that are under time lock
    await expect(
      execute(timelock.connect(admin).executeTransaction, timelockTx)
    ).to.be.revertedWith("Transaction hasn't surpassed time lock");

    // Fast forward until after the grace period for executing the transaction
    await mineBlock(timelockTx.eta.add(await timelock.GRACE_PERIOD()).add(1));

    // Cannot execute transactions that have surpassed the execution period
    await expect(
      execute(timelock.connect(admin).executeTransaction, timelockTx)
    ).to.be.revertedWith("Transaction is stale");
  });
});
