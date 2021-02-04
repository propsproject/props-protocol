import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import chai from "chai";
import * as ethUtil from "ethereumjs-util";
import { solidity } from "ethereum-waffle";
import { ethers } from "hardhat";

import accounts from "../../test-accounts";
import type { AppPoints, TestErc20 } from "../../typechain";
import {
  bn,
  daysToTimestamp,
  deployContractUpgradeable,
  expandTo18Decimals,
  getApprovalDigest,
  getPublicKey,
  getTxTimestamp,
  mineBlock,
  now,
} from "../../utils";

chai.use(solidity);
const { expect } = chai;

describe("AppPoints", () => {
  let appPointsOwner: SignerWithAddress;
  let propsTreasury: SignerWithAddress;
  let alice: SignerWithAddress;

  let appPoints: AppPoints;

  const APP_POINTS_TOKEN_NAME = "AppPoints";
  const APP_POINTS_TOKEN_SYMBOL = "AppPoints";
  const APP_POINTS_TOKEN_AMOUNT = expandTo18Decimals(100000);

  beforeEach(async () => {
    [appPointsOwner, propsTreasury, alice] = await ethers.getSigners();

    appPoints = await deployContractUpgradeable("AppPoints", appPointsOwner, [
      APP_POINTS_TOKEN_NAME,
      APP_POINTS_TOKEN_SYMBOL,
      APP_POINTS_TOKEN_AMOUNT,
      appPointsOwner.address,
      propsTreasury.address,
      bn(0),
    ]);
  });

  it("correctly mints and distributes initial token amounts on initialization", async () => {
    const propsTreasuryMintPercentage = await appPoints.propsTreasuryMintPercentage();
    const appPointsOwnerBalance = await appPoints.balanceOf(appPointsOwner.address);
    const propsTreasuryBalance = await appPoints.balanceOf(propsTreasury.address);

    // Proper percentages are distributed to the app token owner and the Props treasury
    expect(appPointsOwnerBalance).to.eq(APP_POINTS_TOKEN_AMOUNT.sub(propsTreasuryBalance));
    expect(propsTreasuryBalance).to.eq(
      APP_POINTS_TOKEN_AMOUNT.mul(propsTreasuryMintPercentage).div(1e6)
    );
  });

  it("proper permissioning", async () => {
    // Only the app token owner can mint
    await expect(appPoints.connect(propsTreasury).mint()).to.be.revertedWith(
      "Ownable: caller is not the owner"
    );
    await appPoints.connect(appPointsOwner).mint();

    // Only the app token owner can change the inflation rate
    await expect(appPoints.connect(propsTreasury).changeInflationRate(bn(1))).to.be.revertedWith(
      "Ownable: caller is not the owner"
    );
    await appPoints.connect(appPointsOwner).changeInflationRate(bn(1));

    // Only the app token owner can recover tokens
    await appPoints.connect(propsTreasury).transfer(appPoints.address, bn(1));
    await expect(
      appPoints
        .connect(propsTreasury)
        .recoverTokens(appPoints.address, propsTreasury.address, bn(1))
    ).to.be.revertedWith("Ownable: caller is not the owner");
    await appPoints
      .connect(appPointsOwner)
      .recoverTokens(appPoints.address, propsTreasury.address, bn(1));
  });

  it("handles mints according to an inflation rate", async () => {
    // Initially, the inflation rate is 0
    expect(await appPoints.inflationRate()).to.eq(bn(0));

    // That is, no additional tokens will get minted
    await appPoints.connect(appPointsOwner).mint();
    expect(await appPoints.totalSupply()).to.eq(APP_POINTS_TOKEN_AMOUNT);

    const newInflationRate = bn(100);

    // There is a delay before a change in the inflation rate goes into effect
    await appPoints.connect(appPointsOwner).changeInflationRate(newInflationRate);
    await appPoints.connect(appPointsOwner).mint();
    expect(await appPoints.totalSupply()).to.eq(APP_POINTS_TOKEN_AMOUNT);

    // Fast-forward until after the inflation rate delay
    await mineBlock((await now()).add(await appPoints.inflationRateChangeDelay()).add(1));

    // New tokens can get minted once the delay for the inflation rate passed
    const initialMintTime = await appPoints.lastMint();
    const newMintTime = await getTxTimestamp(await appPoints.connect(appPointsOwner).mint());
    expect(await appPoints.totalSupply()).to.eq(
      APP_POINTS_TOKEN_AMOUNT.add(newInflationRate.mul(newMintTime.sub(initialMintTime)))
    );
  });

  it("totalSupply takes into account the inflation rate", async () => {
    const newInflationRate = bn(100);

    // There is a delay before a change in the inflation rate goes into effect
    await appPoints.connect(appPointsOwner).changeInflationRate(newInflationRate);
    expect(await appPoints.totalSupply()).to.eq(APP_POINTS_TOKEN_AMOUNT);

    // Fast-forward until after the inflation rate delay
    await mineBlock((await now()).add(await appPoints.inflationRateChangeDelay()).add(1));

    // Calling totalSupply should take into account the new inflation rate
    expect(await appPoints.totalSupply()).to.be.gte(APP_POINTS_TOKEN_AMOUNT);
  });

  it("recover tokens accidentally sent to contract", async () => {
    const erc20: TestErc20 = await deployContractUpgradeable("TestERC20", alice, [
      "Test",
      "Test",
      bn(100),
    ]);

    // Transfer to app token contract
    await erc20.connect(alice).transfer(appPoints.address, bn(100));
    expect(await erc20.balanceOf(alice.address)).to.eq(bn(0));

    // Have the app token owner recover the tokens
    await appPoints.connect(appPointsOwner).recoverTokens(erc20.address, alice.address, bn(100));
    expect(await erc20.balanceOf(alice.address)).to.eq(bn(100));
  });

  it("approve via off-chain signature (permit)", async () => {
    const permitValue = bn(100);
    const permitDeadline = (await now()).add(daysToTimestamp(1));
    const approvalDigest = await getApprovalDigest(
      appPoints,
      {
        owner: appPointsOwner.address,
        spender: alice.address,
        value: permitValue,
      },
      await appPoints.nonces(alice.address),
      permitDeadline
    );

    // Sign the approval digest
    const sig = ethUtil.ecsign(
      Buffer.from(approvalDigest.slice(2), "hex"),
      Buffer.from(
        accounts
          .find(({ privateKey }) => getPublicKey(privateKey) === appPointsOwner.address)!
          .privateKey.slice(2),
        "hex"
      )
    );

    // Call permit
    await appPoints
      .connect(alice)
      .permit(
        appPointsOwner.address,
        alice.address,
        permitValue,
        permitDeadline,
        sig.v,
        sig.r,
        sig.s
      );

    // The approval indeed took place
    expect(await appPoints.allowance(appPointsOwner.address, alice.address)).to.eq(permitValue);

    // Replay attack fails
    expect(
      appPoints
        .connect(alice)
        .permit(
          appPointsOwner.address,
          alice.address,
          permitValue,
          permitDeadline,
          sig.v,
          sig.r,
          sig.s
        )
    ).to.be.revertedWith("Invalid signature");
  });

  it("non-transferrable when paused", async () => {
    // Pause
    await appPoints.connect(appPointsOwner).pause();

    // Try transferring
    await expect(
      appPoints.connect(appPointsOwner).transfer(alice.address, bn(100))
    ).to.be.revertedWith("Paused");

    // Whitelist the app token owner
    await appPoints.connect(appPointsOwner).whitelistAddress(appPointsOwner.address);

    // Only whitelisted addresses are able to transfer
    await appPoints.connect(appPointsOwner).transfer(alice.address, bn(100));
    await expect(
      appPoints.connect(alice).transfer(appPointsOwner.address, bn(100))
    ).to.be.revertedWith("Paused");

    // Blacklist the app token owner
    await appPoints.connect(appPointsOwner).blacklistAddress(appPointsOwner.address);

    // After blacklist, transfers will fail once again
    await expect(
      appPoints.connect(appPointsOwner).transfer(alice.address, bn(100))
    ).to.be.revertedWith("Paused");
  });
});
