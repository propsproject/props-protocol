import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { ethers } from "hardhat";

import type { AppPointsL2 } from "../../../typechain";
import { bn, deployContractUpgradeable } from "../../../utils";

chai.use(solidity);
const { expect } = chai;

describe("AppPointsL2", () => {
  let appOwner: SignerWithAddress;
  let alice: SignerWithAddress;
  let minter: SignerWithAddress;

  let appPoints: AppPointsL2;

  const APP_POINTS_TOKEN_NAME = "AppPoints";
  const APP_POINTS_TOKEN_SYMBOL = "AppPoints";

  beforeEach(async () => {
    [appOwner, alice, minter] = await ethers.getSigners();

    appPoints = await deployContractUpgradeable(
      "AppPointsL2",
      appOwner,
      APP_POINTS_TOKEN_NAME,
      APP_POINTS_TOKEN_SYMBOL
    );
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
