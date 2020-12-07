import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { BigNumber } from "ethers";
import { ethers } from "hardhat";

import { SProps } from "../typechain/SProps";
import {
  daysToTimestamp,
  deployContract,
  expandTo18Decimals,
  getEvent,
  mineBlock
} from "./utils";

chai.use(solidity);
const { expect } = chai;

describe("SProps", () => {
  let signers: SignerWithAddress[];
  
  let sProps: SProps;

  beforeEach(async () => {
    signers = await ethers.getSigners();

    sProps = await deployContract(
      "SProps",
      signers[0],
      signers[0].address, // account
      signers[0].address, // minter_
      BigNumber.from(Date.now()).add(daysToTimestamp(365)) // mintingAllowedAfter_
    );
  });

  it("calling transferWithLock properly locks the transferred tokens", async () => {
    const amount = expandTo18Decimals(100);

    // Transfer a locked amount
    const tx = await sProps.connect(signers[0]).transferWithLock(signers[1].address, amount);
    const [,, lockTime, unlockTime] = await getEvent(await tx.wait(), "Locked(address,uint256,uint256,uint256)");

    // The balance is still 0 as the locked tokens don't count
    expect(await sProps.balanceOf(signers[1].address)).to.eq(BigNumber.from(0));
    // The total balance gets updated accordingly
    expect(await sProps.totalBalanceOf(signers[1].address)).to.eq(amount);
    // The unlock time for the transferred tokens is correctly set
    expect(unlockTime).to.eq(lockTime.add(await sProps.lockDuration()));

    // Try to unlock the locked tokens and check that it failed
    await sProps.unlock(signers[1].address, [lockTime]);
    expect(await sProps.balanceOf(signers[1].address)).to.eq(BigNumber.from(0));
    expect(await sProps.totalBalanceOf(signers[1].address)).to.eq(amount);

    // Fast forward until after the unlock time
    await mineBlock(ethers.provider, unlockTime.add(1));

    // Unlock the locked tokens and check that it succeeded
    await sProps.unlock(signers[1].address, [lockTime]);
    expect(await sProps.balanceOf(signers[1].address)).to.eq(amount);
    expect(await sProps.totalBalanceOf(signers[1].address)).to.eq(amount);
  });

  it("delegation takes into account the total balance of the delegator", async () => {
    const amount = expandTo18Decimals(100);

    // Transfer a locked amount
    const tx = await sProps.connect(signers[0]).transferWithLock(signers[1].address, amount);
    const [,,, unlockTime] = await getEvent(await tx.wait(), "Locked(address,uint256,uint256,uint256)");
    
    // Fast forward until after the unlock time
    await mineBlock(ethers.provider, unlockTime.add(1));

    // Delegate and check that the locked tokens were accounted for in the delegation
    await sProps.connect(signers[1]).delegate(signers[2].address);
    expect(await sProps.getCurrentVotes(signers[2].address)).to.eq(amount);
  });
});
