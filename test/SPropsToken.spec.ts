import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { ethers } from "hardhat";

import { RewardsEscrow } from "../typechain/RewardsEscrow";
import { SPropsToken } from "../typechain/SPropsToken";
import {
  bn,
  deployContract,
  expandTo18Decimals,
  getFutureAddress,
} from "./utils";

chai.use(solidity);
const { expect } = chai;

describe("SPropsToken", async () => {
  let deployer: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;
  
  let rewardsEscrow: RewardsEscrow;
  let sProps: SPropsToken;

  const REWARDS_ESCROW_LOCK_DURATION = bn(100);

  const SPROPS_TOKEN_SUPPLY = expandTo18Decimals(1000);

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
  });

  it("delegation takes into account both the transferrable and locked balances of the delegator", async () => {
    const transferrableAmount = expandTo18Decimals(100);
    const lockedAmount = expandTo18Decimals(50);

    // Transfer a given amount to alice
    await sProps.connect(deployer).transfer(alice.address, transferrableAmount);

    // Lock a given amount in the rewards escrow to alice
    await sProps.connect(deployer).approve(rewardsEscrow.address, lockedAmount);
    await rewardsEscrow.lock(alice.address, lockedAmount);

    // Delegate and check the voting power
    await sProps.connect(alice).delegate(alice.address);
    expect(await sProps.getCurrentVotes(alice.address)).to.eq(transferrableAmount.add(lockedAmount));
  });
});
