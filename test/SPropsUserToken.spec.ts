import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { ethers } from "hardhat";

import type { SPropsUserToken } from "../typechain";
import {
  deployContract,
  expandTo18Decimals
} from "./utils";

chai.use(solidity);
const { expect } = chai;

describe("SPropsUserToken", () => {
  let owner: SignerWithAddress;
  let alice: SignerWithAddress;

  let sPropsUserToken: SPropsUserToken;

  beforeEach(async () => {
    [owner, alice, ] = await ethers.getSigners();

    sPropsUserToken = await deployContract<SPropsUserToken>("SPropsUserToken", owner);
    await sPropsUserToken.connect(owner).initialize();
  });

  it("only the owner can mint user sProps", async () => {
    const mintAmount = expandTo18Decimals(100);

    // Try minting from non-owner
    await expect(
      sPropsUserToken.connect(alice).mint(alice.address, mintAmount)
    ).to.be.revertedWith("Ownable: caller is not the owner");

    // Mint from owner and check that it succeeded
    await sPropsUserToken.connect(owner).mint(owner.address, mintAmount);
    expect(await sPropsUserToken.totalSupply()).to.eq(mintAmount);
    expect(await sPropsUserToken.balanceOf(owner.address)).to.eq(mintAmount);
  });

  it("user sProps are not transferrable", async () => {
    const mintAmount = expandTo18Decimals(100);

    // Mint some tokens
    await sPropsUserToken.connect(owner).mint(owner.address, mintAmount);

    // Try transferring
    await expect(
      sPropsUserToken.connect(owner).transfer(alice.address, mintAmount)
    ).to.be.revertedWith("sPropsUser are not transferrable");

    // Try approving
    await expect(
      sPropsUserToken.connect(owner).approve(alice.address, mintAmount)
    ).to.be.revertedWith("sPropsUser are not transferrable");
  });
});
