import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import chai from "chai";
import { BigNumberish } from "ethers";
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

  const generatePermit = async (owner: string, spender: string, value: BigNumberish) => {
    const permitMessage = {
      owner,
      spender,
      value: value.toString(),
      nonce: (await appPoints.nonces(owner)).toString(),
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
      sigUtil.signTypedData_v4(getPrivateKey(owner), { data: permitData })
    );

    return {
      permitMessage,
      permitSig,
    };
  };

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
    // Generate permit
    const permit = await generatePermit(appOwner.address, alice.address, bn(100));

    // Permit
    await appPoints
      .connect(alice)
      .permit(
        permit.permitMessage.owner,
        permit.permitMessage.spender,
        permit.permitMessage.value,
        permit.permitMessage.deadline,
        permit.permitSig.v,
        permit.permitSig.r,
        permit.permitSig.s
      );

    // The approval indeed took place
    expect(await appPoints.allowance(appOwner.address, alice.address)).to.eq(
      permit.permitMessage.value
    );

    // Replay attack fails
    await expect(
      appPoints
        .connect(alice)
        .permit(
          permit.permitMessage.owner,
          permit.permitMessage.spender,
          permit.permitMessage.value,
          permit.permitMessage.deadline,
          permit.permitSig.v,
          permit.permitSig.r,
          permit.permitSig.s
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

  it("minter can deposit", async () => {
    const depositData = new ethers.utils.AbiCoder().encode(["uint256"], [bn(100)]);

    // Only the app owner can set the minter
    await expect(appPoints.connect(alice).setMinter(minter.address)).to.be.revertedWith(
      "Ownable: caller is not the owner"
    );
    await appPoints.connect(appOwner).setMinter(minter.address);

    // Only the minter can initiate a deposit
    await expect(appPoints.connect(alice).deposit(alice.address, depositData)).to.be.revertedWith(
      "Unauthorized"
    );
    await appPoints.connect(minter).deposit(alice.address, depositData);
    expect(await appPoints.balanceOf(alice.address)).to.eq(bn(100));

    // Remove the minter
    await appPoints.connect(appOwner).setMinter("0x0000000000000000000000000000000000000000");

    // Once removed, a minter can no longer initiate new deposits
    await expect(appPoints.connect(minter).deposit(alice.address, depositData)).to.be.revertedWith(
      "Unauthorized"
    );
  });

  it("withdraw", async () => {
    // Deposit some tokens
    await appPoints.connect(appOwner).setMinter(minter.address);
    await appPoints
      .connect(minter)
      .deposit(alice.address, new ethers.utils.AbiCoder().encode(["uint256"], [bn(100)]));
    expect(await appPoints.totalSupply()).to.eq(bn(100));

    // Cannot withdraw more than the balance
    await expect(appPoints.connect(alice).withdraw(bn(200))).to.be.revertedWith(
      "ERC20: burn amount exceeds balance"
    );

    // Withdraw triggers a token burn
    await appPoints.connect(alice).withdraw(bn(20));
    expect(await appPoints.totalSupply()).to.eq(bn(80));
    expect(await appPoints.balanceOf(alice.address)).to.eq(bn(80));
  });

  it("withdraw with permit", async () => {
    // Deposit some tokens
    await appPoints.connect(appOwner).setMinter(minter.address);
    await appPoints
      .connect(minter)
      .deposit(alice.address, new ethers.utils.AbiCoder().encode(["uint256"], [bn(100)]));
    expect(await appPoints.totalSupply()).to.eq(bn(100));

    // Generate permit
    const validPermit = await generatePermit(alice.address, appPoints.address, bn(50));

    // Withdraw with permit
    await appPoints
      .connect(appOwner)
      .withdrawWithPermit(
        validPermit.permitMessage.owner,
        validPermit.permitMessage.spender,
        validPermit.permitMessage.value,
        validPermit.permitMessage.deadline,
        validPermit.permitSig.v,
        validPermit.permitSig.r,
        validPermit.permitSig.s
      );
    expect(await appPoints.totalSupply()).to.eq(bn(50));
    expect(await appPoints.balanceOf(alice.address)).to.eq(bn(50));
    expect(await appPoints.allowance(alice.address, appPoints.address)).to.eq(bn(0));

    // Generate invalid permit
    const invalidPermit = await generatePermit(alice.address, minter.address, bn(50));
    await expect(
      appPoints
        .connect(appOwner)
        .withdrawWithPermit(
          invalidPermit.permitMessage.owner,
          invalidPermit.permitMessage.spender,
          invalidPermit.permitMessage.value,
          invalidPermit.permitMessage.deadline,
          invalidPermit.permitSig.v,
          invalidPermit.permitSig.r,
          invalidPermit.permitSig.s
        )
    ).to.be.revertedWith("Wrong permit");
  });
});
