import chai from "chai";
import chaiSubset from "chai-subset";
import { solidity } from "ethereum-waffle";
import { ethers } from "hardhat";
import { ContractFactory, Signer, BigNumber, utils } from "ethers";
import { AirdropDistribution } from "../../types/AirdropDistribution";

import { Erc20Mock } from "../../types/Erc20Mock";
import { getAddress, parseEther } from "ethers/lib/utils";
import { MAXIMUM_U256, ZERO_ADDRESS, mineBlocks, increaseTime } from "../utils/helpers";

chai.use(solidity);
chai.use(chaiSubset);

const { expect } = chai;

let AirdropDistributionFactory: ContractFactory;
let ERC20MockFactory: ContractFactory;

describe("RewardVesting", () => {
  let deployer: Signer;
  let player: Signer;
  let player2: Signer;
  let governance: Signer;
  let newGovernance: Signer;
  let signers: Signer[];

  let airdropDistribution: AirdropDistribution;
  let airdropToken: Erc20Mock;


  before(async () => {
    AirdropDistributionFactory = await ethers.getContractFactory("AirdropDistribution");
    ERC20MockFactory = await ethers.getContractFactory("ERC20Mock");
  });

  beforeEach(async () => {
    [deployer, player,player2,governance, newGovernance, ...signers] = await ethers.getSigners();

    airdropToken = (await ERC20MockFactory.connect(deployer).deploy(
      "Wasabi Token",
      "WASABI",
      18
    )) as Erc20Mock;

    airdropDistribution = (await AirdropDistributionFactory.connect(deployer).deploy(await governance.getAddress())) as AirdropDistribution;

    await airdropDistribution.connect(governance).initialize(airdropToken.address,[await player.getAddress(),await player2.getAddress()],['12000','1200']);

    await airdropToken.connect(deployer).mint(airdropDistribution.address,'13200');

  });

  describe("set governance", () => {
    it("only allows governance", async () => {
      expect(airdropDistribution.connect(player).setPendingGovernance(await newGovernance.getAddress())).revertedWith(
        "AirdropDistribution: only governance"
      );
    });

    context("when caller is governance", () => {
      beforeEach(async () => {
        airdropDistribution = airdropDistribution.connect(governance);
      });

      it("prevents getting stuck", async () => {
        expect(airdropDistribution.setPendingGovernance(ZERO_ADDRESS)).revertedWith(
          "AirdropDistribution: pending governance address cannot be 0x0"
        );
      });

      it("sets the pending governance", async () => {
        await airdropDistribution.setPendingGovernance(await newGovernance.getAddress());
        expect(await airdropDistribution.governance()).equal(await governance.getAddress());
      });

      it("updates governance upon acceptance", async () => {
        await airdropDistribution.setPendingGovernance(await newGovernance.getAddress());
        await airdropDistribution.connect(newGovernance).acceptGovernance()
        expect(await airdropDistribution.governance()).equal(await newGovernance.getAddress());
      });

      it("emits GovernanceUpdated event", async () => {
        await airdropDistribution.setPendingGovernance(await newGovernance.getAddress());
        expect(airdropDistribution.connect(newGovernance).acceptGovernance())
          .emit(airdropDistribution, "GovernanceUpdated")
          .withArgs(await newGovernance.getAddress());
      });
    });
  });


  describe("Airdrop action", ()=>{

    it("player can see avalible reward", async() => {
      expect(await airdropDistribution.getInitialAirdropAmount(await player.getAddress())).to.equal(12000);
      expect(await airdropDistribution.getInitialAirdropAmount(await player2.getAddress())).to.equal(1200);
      expect(await airdropDistribution.getDistributedAmount(await player.getAddress())).to.equal(0);
      expect(await airdropDistribution.getDistributedAmount(await player2.getAddress())).to.equal(0);
      expect(await airdropDistribution.getAvailableAmount(await player.getAddress())).to.equal(12000);
      expect(await airdropDistribution.getAvailableAmount(await player2.getAddress())).to.equal(1200);

    })

    it("player cannot withdraw when pause", async() => {
      await expect(airdropDistribution.connect(player).withdraw(1)).to.be.revertedWith("Withdraw paused");
      await expect(airdropDistribution.connect(player2).withdraw(1)).to.be.revertedWith("Withdraw paused");

    })

    it("player can withdraw all and left 0 avalible", async() => {
      await airdropDistribution.connect(governance).setPause(false);
      expect(await airdropToken.balanceOf(await player.getAddress())).to.equal(0);
      await airdropDistribution.connect(player).withdraw('12000');
      expect(await airdropToken.balanceOf(await player.getAddress())).to.equal(12000);
      expect(await airdropDistribution.getAvailableAmount(await player.getAddress())).to.equal(0);
      expect(await airdropToken.balanceOf(airdropDistribution.address)).to.equal(1200);
    })

    it("player has 11300 avalible after withdraw 700", async() => {
      await airdropDistribution.connect(governance).setPause(false);
      expect(await airdropDistribution.getAvailableAmount(await player.getAddress())).to.equal(12000);

      await airdropDistribution.connect(player).withdraw('700');
      expect(await airdropToken.balanceOf(await player.getAddress())).to.equal(700);
      expect(await airdropDistribution.getAvailableAmount(await player.getAddress())).to.equal(11300);
    })


    it("will fail for insufficient balance", async() => {
      await airdropDistribution.connect(governance).setPause(false);
      expect(await airdropDistribution.getAvailableAmount(await player.getAddress())).to.equal(12000);

      await airdropDistribution.connect(player).withdraw('700');
      expect(await airdropToken.balanceOf(await player.getAddress())).to.equal(700);
      expect(await airdropDistribution.getAvailableAmount(await player.getAddress())).to.equal(11300);

      await expect(airdropDistribution.connect(player).withdraw(12000)).to.be.revertedWith("insufficient avalible balance");

    })

    it("multiple user case", async() => {
      await airdropDistribution.connect(governance).setPause(false);
      expect(await airdropDistribution.getAvailableAmount(await player.getAddress())).to.equal(12000);
      expect(await airdropDistribution.getAvailableAmount(await player2.getAddress())).to.equal(1200);

      await airdropDistribution.connect(player).withdraw('700');
      expect(await airdropToken.balanceOf(await player.getAddress())).to.equal(700);
      expect(await airdropDistribution.getAvailableAmount(await player.getAddress())).to.equal(11300);

      await airdropDistribution.connect(player2).withdraw('100');
      expect(await airdropToken.balanceOf(await player2.getAddress())).to.equal(100);
      expect(await airdropDistribution.getAvailableAmount(await player2.getAddress())).to.equal(1100);

      await airdropDistribution.connect(player).withdraw('1300');
      expect(await airdropToken.balanceOf(await player.getAddress())).to.equal(2000);
      expect(await airdropDistribution.getAvailableAmount(await player.getAddress())).to.equal(10000);

      await airdropDistribution.connect(player2).withdraw('100');
      expect(await airdropToken.balanceOf(await player2.getAddress())).to.equal(200);
      expect(await airdropDistribution.getAvailableAmount(await player2.getAddress())).to.equal(1000);

      expect(await airdropToken.balanceOf(airdropDistribution.address)).to.equal(11000);

      await airdropDistribution.connect(player).withdraw('10000');
      expect(await airdropToken.balanceOf(await player.getAddress())).to.equal(12000);
      expect(await airdropDistribution.getAvailableAmount(await player.getAddress())).to.equal(0);

      await airdropDistribution.connect(player2).withdraw('1000');
      expect(await airdropToken.balanceOf(await player2.getAddress())).to.equal(1200);
      expect(await airdropDistribution.getAvailableAmount(await player2.getAddress())).to.equal(0);

      expect(await airdropToken.balanceOf(airdropDistribution.address)).to.equal(0);

    })

  })


});
