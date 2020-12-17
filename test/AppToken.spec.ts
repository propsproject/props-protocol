import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { ethers } from "hardhat";

import type { AppToken } from "../typechain";
import {
  bn,
  deployContract,
  expandTo18Decimals,
  mineBlock,
  now
} from "./utils";

chai.use(solidity);
const { expect } = chai;

describe("AppToken", () => {
  let appTokenOwner: SignerWithAddress;
  let propsTreasury: SignerWithAddress;

  let appToken: AppToken;

  const APP_TOKEN_NAME = "AppToken";
  const APP_TOKEN_SYMBOL = "AppToken";
  const APP_TOKEN_AMOUNT = expandTo18Decimals(1000);

  beforeEach(async () => {
    [appTokenOwner, propsTreasury, ] = await ethers.getSigners();

    appToken = await deployContract<AppToken>("AppToken", appTokenOwner);
    await appToken.connect(appTokenOwner)
      .initialize(
        APP_TOKEN_NAME,
        APP_TOKEN_SYMBOL,
        APP_TOKEN_AMOUNT,
        appTokenOwner.address,
        propsTreasury.address
      );
  });

  it("correctly mints and distributes initial token amounts on initialization", async () => {
    const propsTreasuryMintPercentage = await appToken.propsTreasuryMintPercentage();
    const appTokenOwnerBalance = await appToken.balanceOf(appTokenOwner.address);
    const propsTreasuryBalance = await appToken.balanceOf(propsTreasury.address);

    // Proper percentages are distributed to the app token owner and the Props treasury
    expect(appTokenOwnerBalance).to.eq(APP_TOKEN_AMOUNT.sub(propsTreasuryBalance));
    expect(propsTreasuryBalance).to.eq(APP_TOKEN_AMOUNT.mul(propsTreasuryMintPercentage).div(1e6));
  });

  it("only allows the app token owner to make state changes", async () => {
    // Only the app token owner can mint
    await expect(
      appToken.connect(propsTreasury).mint()
    ).to.be.revertedWith("Ownable: caller is not the owner");
    await appToken.connect(appTokenOwner).mint();

    // Only the app token owner can change the inflation rate
    await expect(
      appToken.connect(propsTreasury).changeInflationRate(bn(1))
    ).to.be.revertedWith("Ownable: caller is not the owner");
    await appToken.connect(appTokenOwner).changeInflationRate(bn(1));
  });

  it("can handle mints according to an inflation rate", async () => {
    // Initially, the inflation rate is 0
    expect(await appToken.inflationRate()).to.eq(bn(0));

    // That is, no additional tokens will get minted
    await appToken.connect(appTokenOwner).mint();
    expect(await appToken.totalSupply()).to.eq(APP_TOKEN_AMOUNT);

    // There is a delay before a change in the inflation rate goes into effect
    await appToken.connect(appTokenOwner).changeInflationRate(bn(100));
    await appToken.connect(appTokenOwner).mint();
    expect(await appToken.totalSupply()).to.eq(APP_TOKEN_AMOUNT);

    // Fast-forward until after the inflation rate delay
    await mineBlock((await now()).add(await appToken.inflationRateChangeDelay()).add(1));

    // New tokens can get minted once the delay for the inflation rate passed
    await appToken.connect(appTokenOwner).mint();
    expect((await appToken.totalSupply()).gt(APP_TOKEN_AMOUNT)).to.be.true;
  });
});
