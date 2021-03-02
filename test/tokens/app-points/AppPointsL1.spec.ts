import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import chai from "chai";
import * as ethUtil from "ethereumjs-util";
import { solidity } from "ethereum-waffle";
import * as sigUtil from "eth-sig-util";
import { ethers } from "hardhat";

import type { AppPointsL1, MockErc20 } from "../../../typechain";
import {
  bn,
  daysToTimestamp,
  deployContractUpgradeable,
  expandTo18Decimals,
  getPrivateKey,
  getTxTimestamp,
  mineBlock,
  now,
} from "../../../utils";

chai.use(solidity);
const { expect } = chai;

describe("AppPointsL1", () => {
  let appOwner: SignerWithAddress;
  let treasury: SignerWithAddress;
  let alice: SignerWithAddress;

  let appPoints: AppPointsL1;

  const APP_POINTS_TOKEN_NAME = "AppPoints";
  const APP_POINTS_TOKEN_SYMBOL = "AppPoints";
  const APP_POINTS_TOKEN_AMOUNT = expandTo18Decimals(100000);

  beforeEach(async () => {
    [appOwner, treasury, alice] = await ethers.getSigners();

    appPoints = await deployContractUpgradeable(
      "AppPointsL1",
      appOwner,
      APP_POINTS_TOKEN_NAME,
      APP_POINTS_TOKEN_SYMBOL,
      APP_POINTS_TOKEN_AMOUNT,
      appOwner.address,
      treasury.address
    );
  });

  it("correctly mints and distributes initial token amounts on initialization", async () => {
    const treasuryMintPercentage = await appPoints.propsTreasuryMintPercentage();
    const appOwnerBalance = await appPoints.balanceOf(appOwner.address);
    const treasuryBalance = await appPoints.balanceOf(treasury.address);

    // Proper percentages are distributed to the app token owner and the Props treasury
    expect(appOwnerBalance).to.eq(APP_POINTS_TOKEN_AMOUNT.sub(treasuryBalance));
    expect(treasuryBalance).to.eq(APP_POINTS_TOKEN_AMOUNT.mul(treasuryMintPercentage).div(1e6));
  });

  it("proper permissioning", async () => {
    // Only the app token owner can mint
    await expect(appPoints.connect(treasury).mint()).to.be.revertedWith(
      "Ownable: caller is not the owner"
    );
    await appPoints.connect(appOwner).mint();

    // Only the app token owner can change the inflation rate
    await expect(appPoints.connect(treasury).changeInflationRate(bn(1))).to.be.revertedWith(
      "Ownable: caller is not the owner"
    );
    await appPoints.connect(appOwner).changeInflationRate(bn(1));

    // Only the app token owner can recover tokens
    await appPoints.connect(treasury).transfer(appPoints.address, bn(1));
    await expect(
      appPoints.connect(treasury).recoverTokens(appPoints.address, treasury.address, bn(1))
    ).to.be.revertedWith("Ownable: caller is not the owner");
    await appPoints.connect(appOwner).recoverTokens(appPoints.address, treasury.address, bn(1));
  });

  it("handles mints according to an inflation rate", async () => {
    // Initially, the inflation rate is 0
    expect(await appPoints.inflationRate()).to.eq(bn(0));

    // That is, no additional tokens will get minted
    await appPoints.connect(appOwner).mint();
    expect(await appPoints.totalSupply()).to.eq(APP_POINTS_TOKEN_AMOUNT);

    const newInflationRate = bn(100);

    // There is a delay before a change in the inflation rate goes into effect
    await appPoints.connect(appOwner).changeInflationRate(newInflationRate);
    await appPoints.connect(appOwner).mint();
    expect(await appPoints.totalSupply()).to.eq(APP_POINTS_TOKEN_AMOUNT);

    // Fast-forward until after the inflation rate delay
    await mineBlock((await now()).add(await appPoints.inflationRateChangeDelay()).add(1));

    // New tokens can get minted once the delay for the inflation rate passed
    const initialMintTime = await appPoints.lastMint();
    const newMintTime = await getTxTimestamp(await appPoints.connect(appOwner).mint());
    expect(await appPoints.totalSupply()).to.eq(
      APP_POINTS_TOKEN_AMOUNT.add(newInflationRate.mul(newMintTime.sub(initialMintTime)))
    );
  });

  it("totalSupply takes into account the inflation rate", async () => {
    const newInflationRate = bn(100);

    // There is a delay before a change in the inflation rate goes into effect
    await appPoints.connect(appOwner).changeInflationRate(newInflationRate);
    expect(await appPoints.totalSupply()).to.eq(APP_POINTS_TOKEN_AMOUNT);

    // Fast-forward until after the inflation rate delay
    await mineBlock((await now()).add(await appPoints.inflationRateChangeDelay()).add(1));

    // Calling totalSupply should take into account the new inflation rate
    expect(await appPoints.totalSupply()).to.be.gte(APP_POINTS_TOKEN_AMOUNT);
  });

  it("recover tokens accidentally sent to contract", async () => {
    const erc20: MockErc20 = await deployContractUpgradeable(
      "MockERC20",
      alice,
      "Test",
      "Test",
      bn(100)
    );

    // Transfer to app token contract
    await erc20.connect(alice).transfer(appPoints.address, bn(100));
    expect(await erc20.balanceOf(alice.address)).to.eq(bn(0));

    // Have the app token owner recover the tokens
    await appPoints.connect(appOwner).recoverTokens(erc20.address, alice.address, bn(100));
    expect(await erc20.balanceOf(alice.address)).to.eq(bn(100));
  });

  it("approve via off-chain signature (permit)", async () => {
    // Sign the permit
    const permitMessage = {
      owner: appOwner.address,
      spender: alice.address,
      value: bn(100).toString(),
      nonce: (await appPoints.nonces(appOwner.address)).toString(),
      deadline: (await now()).add(daysToTimestamp(1)).toString(),
    };

    const permitData = {
      domain: {
        chainId: (await ethers.provider.getNetwork()).chainId,
        name: await appPoints.name(),
        verifyingContract: appPoints.address,
        version: "1",
      },
      message: permitMessage,
      primaryType: "Permit" as const,
      types: {
        EIP712Domain: [
          { name: "name", type: "string" },
          { name: "version", type: "string" },
          { name: "chainId", type: "uint256" },
          { name: "verifyingContract", type: "address" },
        ],
        Permit: [
          { name: "owner", type: "address" },
          { name: "spender", type: "address" },
          { name: "value", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      },
    };

    const permitSig = ethUtil.fromRpcSig(
      sigUtil.signTypedData_v4(getPrivateKey(appOwner.address), { data: permitData })
    );

    // Permit
    await appPoints
      .connect(alice)
      .permit(
        permitMessage.owner,
        permitMessage.spender,
        permitMessage.value,
        permitMessage.deadline,
        permitSig.v,
        permitSig.r,
        permitSig.s
      );

    // The approval indeed took place
    expect(await appPoints.allowance(appOwner.address, alice.address)).to.eq(permitMessage.value);

    // Replay attack fails
    await expect(
      appPoints
        .connect(alice)
        .permit(
          permitMessage.owner,
          permitMessage.spender,
          permitMessage.value,
          permitMessage.deadline,
          permitSig.v,
          permitSig.r,
          permitSig.s
        )
    ).to.be.revertedWith("Invalid signature");
  });

  it("non-transferrable when paused", async () => {
    // Pause
    await appPoints.connect(appOwner).pause();

    // Try transferring
    await expect(appPoints.connect(appOwner).transfer(alice.address, bn(100))).to.be.revertedWith(
      "Unauthorized"
    );

    // Whitelist the app token owner
    await appPoints.connect(appOwner).whitelistForTransfers(appOwner.address);

    // Only whitelisted addresses are able to transfer
    await appPoints.connect(appOwner).transfer(alice.address, bn(100));
    await expect(appPoints.connect(alice).transfer(appOwner.address, bn(100))).to.be.revertedWith(
      "Unauthorized"
    );

    // Blacklist the app token owner
    await appPoints.connect(appOwner).blacklistForTransfers(appOwner.address);

    // After blacklist, transfers will fail once again
    await expect(appPoints.connect(appOwner).transfer(alice.address, bn(100))).to.be.revertedWith(
      "Unauthorized"
    );

    // Unpause
    await appPoints.connect(appOwner).unpause();

    // When unpaused, anyone should be free to transfer
    await appPoints.connect(appOwner).transfer(alice.address, bn(100));
  });
});
