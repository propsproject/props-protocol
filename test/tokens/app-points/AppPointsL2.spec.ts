import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import chai from "chai";
import * as ethUtil from "ethereumjs-util";
import { solidity } from "ethereum-waffle";
import * as sigUtil from "eth-sig-util";
import { ethers } from "hardhat";

import type { AppPointsL2 } from "../../../typechain";
import { bn, daysToTimestamp, deployContractUpgradeable, getPrivateKey, now } from "../../../utils";

chai.use(solidity);
const { expect } = chai;

describe("AppPointsL2", () => {
  let deployer: SignerWithAddress;
  let appOwner: SignerWithAddress;
  let alice: SignerWithAddress;
  let minter: SignerWithAddress;

  let appPoints: AppPointsL2;

  const APP_POINTS_TOKEN_NAME = "AppPoints";
  const APP_POINTS_TOKEN_SYMBOL = "AppPoints";

  beforeEach(async () => {
    [deployer, appOwner, alice, minter] = await ethers.getSigners();

    appPoints = await deployContractUpgradeable(
      "AppPointsL2",
      deployer,
      APP_POINTS_TOKEN_NAME,
      APP_POINTS_TOKEN_SYMBOL
    );

    // Mimick the AppProxyFactory by transferring ownership to the app owner
    await appPoints.connect(deployer).transferOwnership(appOwner.address);
  });

  it("correctly initialized", async () => {
    expect(await appPoints.owner()).to.eq(appOwner.address);
    expect(await appPoints.name()).to.eq(APP_POINTS_TOKEN_NAME);
    expect(await appPoints.symbol()).to.eq(APP_POINTS_TOKEN_SYMBOL);
    expect(await appPoints.totalSupply()).to.eq(bn(0));
  });

  it("approve via off-chain signature (permit) from root chain", async () => {
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
        chainId: (await appPoints.ROOT_CHAIN_ID()).toNumber(),
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

  it("update app info", async () => {
    // Only the app owner can update the app info
    await expect(appPoints.connect(alice).changeAppInfo("0x99")).to.be.revertedWith(
      "Ownable: caller is not the owner"
    );
    await appPoints.connect(appOwner).changeAppInfo("0x99");
    expect(await appPoints.appInfo()).to.eq("0x99");
  });

  it("minters can mint/burn", async () => {
    // Only the app owner can add new minters
    await expect(appPoints.connect(alice).addMinter(minter.address)).to.be.revertedWith(
      "Ownable: caller is not the owner"
    );
    await appPoints.connect(appOwner).addMinter(minter.address);

    // Only a minter can mint new tokens
    await expect(appPoints.connect(alice).mint(alice.address, bn(100))).to.be.revertedWith(
      "Unauthorized"
    );
    await appPoints.connect(minter).mint(alice.address, bn(100));
    expect(await appPoints.balanceOf(alice.address)).to.eq(bn(100));

    // Only a minter can burn existing tokens
    await expect(appPoints.connect(alice).burn(alice.address, bn(100))).to.be.revertedWith(
      "Unauthorized"
    );
    await appPoints.connect(minter).burn(alice.address, bn(100));
    expect(await appPoints.balanceOf(alice.address)).to.eq(bn(0));

    // Only the app owner can remove existing minters
    await expect(appPoints.connect(alice).removeMinter(minter.address)).to.be.revertedWith(
      "Ownable: caller is not the owner"
    );
    await appPoints.connect(appOwner).removeMinter(minter.address);

    // Once removed, a minter can no longer mint new tokens
    await expect(appPoints.connect(minter).mint(alice.address, bn(100))).to.be.revertedWith(
      "Unauthorized"
    );
  });
});
