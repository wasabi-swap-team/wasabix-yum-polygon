import chai from "chai";
import chaiSubset from "chai-subset";
import { solidity } from "ethereum-waffle";
import { ethers } from "hardhat";
import { ContractFactory, Signer, BigNumber, utils } from "ethers";
import { CompetitionDistribution } from "../../types/CompetitionDistribution";

import { Erc20Mock } from "../../types/Erc20Mock";
import { getAddress, parseEther } from "ethers/lib/utils";
import { MAXIMUM_U256, ZERO_ADDRESS, mineBlocks, increaseTime } from "../utils/helpers";

chai.use(solidity);
chai.use(chaiSubset);

const { expect } = chai;

let CompetitionDistributionFactory: ContractFactory;
let ERC20MockFactory: ContractFactory;

describe("RewardVesting", () => {
  let deployer: Signer;
  let player: Signer;
  let player2: Signer;
  let governance: Signer;
  let newGovernance: Signer;
  let signers: Signer[];

  let competitionDistribution: CompetitionDistribution;
  let wasabi: Erc20Mock;


  before(async () => {
    CompetitionDistributionFactory = await ethers.getContractFactory("CompetitionDistribution");
    ERC20MockFactory = await ethers.getContractFactory("ERC20Mock");
  });

  beforeEach(async () => {
    [deployer, player,player2,governance, newGovernance, ...signers] = await ethers.getSigners();

    wasabi = (await ERC20MockFactory.connect(deployer).deploy(
      "Wasabi Token",
      "WASABI",
      18
    )) as Erc20Mock;

    competitionDistribution = (await CompetitionDistributionFactory.connect(deployer).deploy(await governance.getAddress(), Math.floor(Date.now() / 1000))) as CompetitionDistribution;

    await competitionDistribution.connect(governance).initialize(wasabi.address,[await player.getAddress(),await player2.getAddress()],['12000','1200']);

    await wasabi.connect(deployer).mint(competitionDistribution.address,'13200');

  });

  describe("set governance", () => {
    it("only allows governance", async () => {
      expect(competitionDistribution.connect(player).setPendingGovernance(await newGovernance.getAddress())).revertedWith(
        "CompetitionDistribution: only governance"
      );
    });

    context("when caller is governance", () => {
      beforeEach(async () => {
        competitionDistribution = competitionDistribution.connect(governance);
      });

      it("prevents getting stuck", async () => {
        expect(competitionDistribution.setPendingGovernance(ZERO_ADDRESS)).revertedWith(
          "CompetitionDistribution: pending governance address cannot be 0x0"
        );
      });

      it("sets the pending governance", async () => {
        await competitionDistribution.setPendingGovernance(await newGovernance.getAddress());
        expect(await competitionDistribution.governance()).equal(await governance.getAddress());
      });

      it("updates governance upon acceptance", async () => {
        await competitionDistribution.setPendingGovernance(await newGovernance.getAddress());
        await competitionDistribution.connect(newGovernance).acceptGovernance()
        expect(await competitionDistribution.governance()).equal(await newGovernance.getAddress());
      });

      it("emits GovernanceUpdated event", async () => {
        await competitionDistribution.setPendingGovernance(await newGovernance.getAddress());
        expect(competitionDistribution.connect(newGovernance).acceptGovernance())
          .emit(competitionDistribution, "GovernanceUpdated")
          .withArgs(await newGovernance.getAddress());
      });
    });
  });


  describe("Vesting", ()=>{

    it("has zero vested", async() => {
      expect(await competitionDistribution.getAvailableAmount(await player.getAddress())).to.equal(0);
    })

    it("has zero vested after 20 days", async() => {
      await increaseTime(ethers.provider, 86400*20);
      await mineBlocks(ethers.provider,1);
      expect(await competitionDistribution.getAvailableAmount(await player.getAddress())).to.equal(0);
    })

    it("has zero vested after 29 days", async() => {

      await increaseTime(ethers.provider, 86400*9);
      await mineBlocks(ethers.provider,1);
      expect(await competitionDistribution.getAvailableAmount(await player.getAddress())).to.equal(0);
    })

    it("has 1000 vested after 31 days", async() => {

      await increaseTime(ethers.provider, 86400*2);
      await mineBlocks(ethers.provider,1);
      expect(await competitionDistribution.getAvailableAmount(await player.getAddress())).to.equal(1000);
    })

    // it("has 2000 vested after 61 days", async() => {
    //
    //   await increaseTime(ethers.provider, 86400*30);
    //   await mineBlocks(ethers.provider,1);
    //   expect(await competitionDistribution.getAvailableAmount(await player.getAddress())).to.equal(2000);
    // })
    //
    // it("has total vested after 500 days", async() => {
    //
    //   await increaseTime(ethers.provider, 86400*439);
    //   await mineBlocks(ethers.provider,1);
    //   expect(await competitionDistribution.getAvailableAmount(await player.getAddress())).to.equal(12000);
    // })
  })

  // describe("Withdraw pause and unpause", ()=>{
  //
  //
  //   it("pause", async() => {
  //
  //     await expect(competitionDistribution.connect(player).withdraw(1)).to.be.revertedWith("Withdraw paused");
  //
  //     await competitionDistribution.connect(governance).setPause(false);
  //
  //     await competitionDistribution.connect(player).withdraw('12000');
  //     expect(await wasabi.balanceOf(await player.getAddress())).to.equal(12000);
  //     expect(await competitionDistribution.getAvailableAmount(await player.getAddress())).to.equal(0);
  //
  //
  //   });
  //
  //
  // })

  // describe("Single withdraw", ()=>{
  //   beforeEach(async () => {
  //     await competitionDistribution.connect(governance).setPause(false);
  //
  //   });
  //
  //
  //   it("has 11300 avalible after withdraw 700", async() => {
  //
  //     expect(await competitionDistribution.getAvailableAmount(await player.getAddress())).to.equal(12000);
  //
  //     await competitionDistribution.connect(player).withdraw('700');
  //     expect(await wasabi.balanceOf(await player.getAddress())).to.equal(700);
  //     expect(await competitionDistribution.getAvailableAmount(await player.getAddress())).to.equal(11300);
  //   })
  //
  //   it("will fail for insufficient balance", async() => {
  //
  //
  //     expect(await competitionDistribution.getAvailableAmount(await player.getAddress())).to.equal(12000);
  //
  //     await competitionDistribution.connect(player).withdraw('700');
  //     expect(await wasabi.balanceOf(await player.getAddress())).to.equal(700);
  //     expect(await competitionDistribution.getAvailableAmount(await player.getAddress())).to.equal(11300);
  //
  //     await expect(competitionDistribution.connect(player).withdraw(12000)).to.be.revertedWith("insufficient avalible balance");
  //
  //   })
  // })

  describe("multiple users withdraw", ()=>{
    beforeEach(async () => {
      await competitionDistribution.connect(governance).setPause(false);

    });


    it("multiple user case", async() => {

      expect(await competitionDistribution.getAvailableAmount(await player.getAddress())).to.equal(1000);
      expect(await competitionDistribution.getAvailableAmount(await player2.getAddress())).to.equal(100);

      await competitionDistribution.connect(player).withdraw('700');
      expect(await wasabi.balanceOf(await player.getAddress())).to.equal(700);
      expect(await competitionDistribution.getAvailableAmount(await player.getAddress())).to.equal(300);

      await competitionDistribution.connect(player2).withdraw('100');
      expect(await wasabi.balanceOf(await player2.getAddress())).to.equal(100);
      expect(await competitionDistribution.getAvailableAmount(await player2.getAddress())).to.equal(0);

      await increaseTime(ethers.provider, 86400*91);
      await mineBlocks(ethers.provider,1);

      expect(await competitionDistribution.getAvailableAmount(await player.getAddress())).to.equal(3300);
      expect(await competitionDistribution.getAvailableAmount(await player2.getAddress())).to.equal(300);

      await competitionDistribution.connect(player).withdraw('1500');
      expect(await wasabi.balanceOf(await player.getAddress())).to.equal(2200);
      expect(await competitionDistribution.getAvailableAmount(await player.getAddress())).to.equal(1800);

      await competitionDistribution.connect(player2).withdraw('250');
      expect(await wasabi.balanceOf(await player2.getAddress())).to.equal(350);
      expect(await competitionDistribution.getAvailableAmount(await player2.getAddress())).to.equal(50);

    })

  })
});
