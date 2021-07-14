import chai from "chai";
import chaiSubset from "chai-subset";
import {solidity} from "ethereum-waffle";
import {ethers} from "hardhat";
import {BigNumber, BigNumberish, ContractFactory, Signer} from "ethers";

import { Erc20Mock } from "../../types/Erc20Mock";
import {BurnableWasabiToken} from "../../types/BurnableWasabiToken";

chai.use(solidity);
chai.use(chaiSubset);

const {expect} = chai;

let WasabiTokenFactory: ContractFactory;

describe("WasabiToken", () => {
  let deployer: Signer;
  let signers: Signer[];

  let token: BurnableWasabiToken;

  before(async () => {
    WasabiTokenFactory = await ethers.getContractFactory("BurnableWasabiToken");
  });

  beforeEach(async () => {
    [deployer, ...signers] = await ethers.getSigners();
  });

  beforeEach(async () => {
    token = await WasabiTokenFactory.deploy() as BurnableWasabiToken;
  });

  it("grants the admin role to the deployer", async () => {
    expect(await token.hasRole(await token.ADMIN_ROLE(), await deployer.getAddress())).is.true;
  });

  it("grants the minter role to the deployer", async () => {
    expect(await token.hasRole(await token.MINTER_ROLE(), await deployer.getAddress())).is.true;
  });

  describe("mint", async () => {
    context("when unauthorized", async () => {
      let unauthorizedMinter: Signer;
      let recipient: Signer;

      beforeEach(async () => [unauthorizedMinter, recipient, ...signers] = signers);

      beforeEach(async () => token = token.connect(unauthorizedMinter));

      it("reverts", async () => {
        expect(token.mint(await recipient.getAddress(), 1))
          .revertedWith("WasabiToken: only minter");
      });
    });

    context("when authorized", async () => {
      let minter: Signer;
      let recipient: Signer;
      let amount: BigNumberish = 1000;

      beforeEach(async () => [minter, recipient, ...signers] = signers);

      beforeEach(async () => await token.grantRole(await token.MINTER_ROLE(), await minter.getAddress()));

      beforeEach(async () => token = token.connect(minter));

      it("mints tokens", async () => {
        await token.mint(await recipient.getAddress(), amount);
        expect(await token.balanceOf(await recipient.getAddress())).equal(amount);
      });
    });
  });

  describe("burn", async () => {

    context("when unauthorized", async () => {

      let minter: Signer;
      let burnfrom: Signer;
      let unauthorizedMinter: Signer;

      beforeEach(async () => {
        [minter,unauthorizedMinter, burnfrom, ...signers] = signers;
        await token.connect(minter);
        await token.grantRole(await token.MINTER_ROLE(), await minter.getAddress())
        await token.connect(minter);
        await token.mint(await burnfrom.getAddress(), 100)

      });
      it("reverts", async () => {
        expect(token.connect(unauthorizedMinter).burn(await burnfrom.getAddress(), 1))
          .revertedWith("WasabiToken: only minter");
      });
    });

    context("when authorized", async () => {

      let minter: Signer;
      let burnfrom: Signer;
      let unauthorizedMinter: Signer;

      beforeEach(async () => {
        [minter,unauthorizedMinter, burnfrom, ...signers] = signers;
        await token.connect(minter);
        await token.grantRole(await token.MINTER_ROLE(), await minter.getAddress())
        await token.connect(minter);
        await token.mint(await burnfrom.getAddress(), 100)

      });
      it("burn token", async () => {
        await token.burn(await burnfrom.getAddress(), 1);
        expect(await token.balanceOf(await burnfrom.getAddress())).equal(99);

        expect(await token.totalSupply()).equal(99);
      });
    });
  });
});
