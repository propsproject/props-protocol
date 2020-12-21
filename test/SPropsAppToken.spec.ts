import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { ethers } from "hardhat";

import type { SPropsAppToken } from "../typechain";
import {
  deployContract,
  expandTo18Decimals,
} from "./utils";

chai.use(solidity);
const { expect } = chai;

describe("SPropsAppToken", () => {
  let owner: SignerWithAddress;
  let alice: SignerWithAddress;

  let sPropsAppToken: SPropsAppToken;

  beforeEach(async () => {
    [owner, alice, ] = await ethers.getSigners();

    sPropsAppToken = await deployContract<SPropsAppToken>("SPropsAppToken", owner);
    await sPropsAppToken.connect(owner).initialize();
  });

  it("only the owner can mint app sProps", async () => {
    const mintAmount = expandTo18Decimals(100);

    // Try minting from non-owner
    await expect(
      sPropsAppToken.connect(alice).mint(alice.address, mintAmount)
    ).to.be.revertedWith("Ownable: caller is not the owner");

    // Mint from owner and check that it succeeded
    await sPropsAppToken.connect(owner).mint(owner.address, mintAmount);
    expect(await sPropsAppToken.totalSupply()).to.eq(mintAmount);
    expect(await sPropsAppToken.balanceOf(owner.address)).to.eq(mintAmount);
  });

  it("app sProps are not transferrable", async () => {
    const mintAmount = expandTo18Decimals(100);

    // Mint some tokens
    await sPropsAppToken.connect(owner).mint(owner.address, mintAmount);

    // Try transferring
    await expect(
      sPropsAppToken.connect(owner).transfer(alice.address, mintAmount)
    ).to.be.revertedWith("sPropsApp are not transferrable");

    // Try approving
    await expect(
      sPropsAppToken.connect(owner).approve(alice.address, mintAmount)
    ).to.be.revertedWith("sPropsApp are not transferrable");
  });
});