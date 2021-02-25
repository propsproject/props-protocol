import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { ethers } from "hardhat";

import type { AppPointsL2 } from "../../../typechain";
import { bn, deployContractUpgradeable, expandTo18Decimals } from "../../../utils";

chai.use(solidity);
const { expect } = chai;

describe("AppPointsL2", () => {
  let bridge: SignerWithAddress;
  let appOwner: SignerWithAddress;
  let alice: SignerWithAddress;

  let appPoints: AppPointsL2;

  const APP_POINTS_TOKEN_NAME = "AppPoints";
  const APP_POINTS_TOKEN_SYMBOL = "AppPoints";

  beforeEach(async () => {
    [bridge, appOwner, alice] = await ethers.getSigners();

    appPoints = await deployContractUpgradeable(
      "AppPointsL2",
      appOwner,
      APP_POINTS_TOKEN_NAME,
      APP_POINTS_TOKEN_SYMBOL,
      bridge.address
    );
  });

  // TODO: Update for multiple minters
  // it("designated bridge can mint and burn app points tokens", async () => {
  //   const amount = expandTo18Decimals(10);

  //   // Mint to Alice
  //   await appPoints.connect(bridge).mint(alice.address, amount);
  //   expect(await appPoints.balanceOf(alice.address)).to.eq(amount);

  //   // Only the bridge is allowed to mint
  //   await expect(appPoints.connect(alice).mint(alice.address, amount)).to.be.revertedWith(
  //     "Unauthorized"
  //   );

  //   // Burn from Alice
  //   await appPoints.connect(bridge).burn(alice.address, amount);
  //   expect(await appPoints.balanceOf(alice.address)).to.eq(bn(0));

  //   // Only the bridge is allowed to burn
  //   await expect(appPoints.connect(alice).burn(alice.address, amount)).to.be.revertedWith(
  //     "Unauthorized"
  //   );
  // });
});
