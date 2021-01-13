import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import chai from "chai";
import * as ethUtil from "ethereumjs-util";
import { solidity } from "ethereum-waffle";
import { ethers } from "hardhat";

import accounts from "../../test-accounts";
import type { AppToken, TestErc20 } from "../../typechain";
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

describe("AppToken", () => {
  let appTokenOwner: SignerWithAddress;
  let propsTreasury: SignerWithAddress;
  let alice: SignerWithAddress;

  let appToken: AppToken;

  const APP_TOKEN_NAME = "AppToken";
  const APP_TOKEN_SYMBOL = "AppToken";
  const APP_TOKEN_AMOUNT = expandTo18Decimals(1000);

  beforeEach(async () => {
    [appTokenOwner, propsTreasury, alice] = await ethers.getSigners();

    appToken = await deployContractUpgradeable("AppToken", appTokenOwner, [
      APP_TOKEN_NAME,
      APP_TOKEN_SYMBOL,
      APP_TOKEN_AMOUNT,
      appTokenOwner.address,
      propsTreasury.address,
      bn(0),
    ]);
  });

  it("correctly mints and distributes initial token amounts on initialization", async () => {
    const propsTreasuryMintPercentage = await appToken.propsTreasuryMintPercentage();
    const appTokenOwnerBalance = await appToken.balanceOf(appTokenOwner.address);
    const propsTreasuryBalance = await appToken.balanceOf(propsTreasury.address);

    // Proper percentages are distributed to the app token owner and the Props treasury
    expect(appTokenOwnerBalance).to.eq(APP_TOKEN_AMOUNT.sub(propsTreasuryBalance));
    expect(propsTreasuryBalance).to.eq(APP_TOKEN_AMOUNT.mul(propsTreasuryMintPercentage).div(1e6));
  });

  it("proper permissioning", async () => {
    // Only the app token owner can mint
    await expect(appToken.connect(propsTreasury).mint()).to.be.revertedWith(
      "Ownable: caller is not the owner"
    );
    await appToken.connect(appTokenOwner).mint();

    // Only the app token owner can change the inflation rate
    await expect(appToken.connect(propsTreasury).changeInflationRate(bn(1))).to.be.revertedWith(
      "Ownable: caller is not the owner"
    );
    await appToken.connect(appTokenOwner).changeInflationRate(bn(1));

    // Only the app token owner can recover tokens
    await appToken.connect(propsTreasury).transfer(appToken.address, bn(1));
    await expect(
      appToken.connect(propsTreasury).recoverTokens(appToken.address, propsTreasury.address, bn(1))
    ).to.be.revertedWith("Ownable: caller is not the owner");
    await appToken
      .connect(appTokenOwner)
      .recoverTokens(appToken.address, propsTreasury.address, bn(1));
  });

  it("handles mints according to an inflation rate", async () => {
    // Initially, the inflation rate is 0
    expect(await appToken.inflationRate()).to.eq(bn(0));

    // That is, no additional tokens will get minted
    await appToken.connect(appTokenOwner).mint();
    expect(await appToken.totalSupply()).to.eq(APP_TOKEN_AMOUNT);

    const newInflationRate = bn(100);

    // There is a delay before a change in the inflation rate goes into effect
    await appToken.connect(appTokenOwner).changeInflationRate(newInflationRate);
    await appToken.connect(appTokenOwner).mint();
    expect(await appToken.totalSupply()).to.eq(APP_TOKEN_AMOUNT);

    // Fast-forward until after the inflation rate delay
    await mineBlock((await now()).add(await appToken.inflationRateChangeDelay()).add(1));

    // New tokens can get minted once the delay for the inflation rate passed
    const initialMintTime = await appToken.lastMint();
    const newMintTime = await getTxTimestamp(await appToken.connect(appTokenOwner).mint());
    expect(await appToken.totalSupply()).to.eq(
      APP_TOKEN_AMOUNT.add(newInflationRate.mul(newMintTime.sub(initialMintTime)))
    );
  });

  it("totalSupply takes into account the inflation rate", async () => {
    const newInflationRate = bn(100);

    // There is a delay before a change in the inflation rate goes into effect
    await appToken.connect(appTokenOwner).changeInflationRate(newInflationRate);
    expect(await appToken.totalSupply()).to.eq(APP_TOKEN_AMOUNT);

    // Fast-forward until after the inflation rate delay
    await mineBlock((await now()).add(await appToken.inflationRateChangeDelay()).add(1));

    // Calling totalSupply should take into account the new inflation rate
    expect(await appToken.totalSupply()).to.be.gte(APP_TOKEN_AMOUNT);
  });

  it("recover tokens accidentally sent to contract", async () => {
    const erc20: TestErc20 = await deployContractUpgradeable("TestERC20", alice, [
      "Test",
      "Test",
      bn(100),
    ]);

    // Transfer to app token contract
    await erc20.connect(alice).transfer(appToken.address, bn(100));
    expect(await erc20.balanceOf(alice.address)).to.eq(bn(0));

    // Have the app token owner recover the tokens
    await appToken.connect(appTokenOwner).recoverTokens(erc20.address, alice.address, bn(100));
    expect(await erc20.balanceOf(alice.address)).to.eq(bn(100));
  });

  it("approve via off-chain signature (permit)", async () => {
    const permitValue = bn(100);
    const permitDeadline = (await now()).add(daysToTimestamp(1));
    const approvalDigest = await getApprovalDigest(
      appToken,
      {
        owner: appTokenOwner.address,
        spender: alice.address,
        value: permitValue,
      },
      await appToken.nonces(alice.address),
      permitDeadline
    );

    // Sign the approval digest
    const sig = ethUtil.ecsign(
      Buffer.from(approvalDigest.slice(2), "hex"),
      Buffer.from(
        accounts
          .find(({ privateKey }) => getPublicKey(privateKey) === appTokenOwner.address)!
          .privateKey.slice(2),
        "hex"
      )
    );

    // Call permit
    await appToken
      .connect(alice)
      .permit(
        appTokenOwner.address,
        alice.address,
        permitValue,
        permitDeadline,
        sig.v,
        sig.r,
        sig.s
      );

    // The approval indeed took place
    expect(await appToken.allowance(appTokenOwner.address, alice.address)).to.eq(permitValue);

    // Replay attack fails
    expect(
      appToken
        .connect(alice)
        .permit(
          appTokenOwner.address,
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
    await appToken.connect(appTokenOwner).pause();

    // Try transferring
    await expect(
      appToken.connect(appTokenOwner).transfer(alice.address, bn(100))
    ).to.be.revertedWith("Paused");

    // Whitelist the app token owner
    await appToken.connect(appTokenOwner).whitelistAddress(appTokenOwner.address);

    // Only whitelisted addresses are able to transfer
    await appToken.connect(appTokenOwner).transfer(alice.address, bn(100));
    await expect(
      appToken.connect(alice).transfer(appTokenOwner.address, bn(100))
    ).to.be.revertedWith("Paused");

    // Blacklist the app token owner
    await appToken.connect(appTokenOwner).blacklistAddress(appTokenOwner.address);

    // After blacklist, transfers will fail once again
    await expect(
      appToken.connect(appTokenOwner).transfer(alice.address, bn(100))
    ).to.be.revertedWith("Paused");
  });
});
