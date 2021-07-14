import chai from "chai";
import chaiSubset from "chai-subset";
import { solidity } from "ethereum-waffle";
import { ethers } from "hardhat";
import { ContractFactory, Signer, BigNumber, utils } from "ethers";
import {  } from "../../types/WaToken";
import { RewardVesting } from "../../types/RewardVesting";

import { Erc20Mock } from "../../types/Erc20Mock";
import { getAddress, parseEther } from "ethers/lib/utils";
import { MAXIMUM_U256, ZERO_ADDRESS, mineBlocks, increaseTime } from "../utils/helpers";

chai.use(solidity);
chai.use(chaiSubset);

const { expect } = chai;

let RewardVestingFactory: ContractFactory;
let ERC20MockFactory: ContractFactory;

describe("RewardVesting", () => {
  let deployer: Signer;
  let player: Signer;
  let player2: Signer;
  let mockPool: Signer;
  let governance: Signer;
  let newGovernance: Signer;
  let signers: Signer[];

  let rewardVesting: RewardVesting;
  let reward: Erc20Mock;


  before(async () => {
    RewardVestingFactory = await ethers.getContractFactory("RewardVesting");
    ERC20MockFactory = await ethers.getContractFactory("ERC20Mock");
  });

  beforeEach(async () => {
    [deployer, player, mockPool, player2,governance, newGovernance, ...signers] = await ethers.getSigners();

    reward = (await ERC20MockFactory.connect(deployer).deploy(
      "Test Token",
      "TEST",
      18
    )) as Erc20Mock;

    rewardVesting = (await RewardVestingFactory.connect(deployer).deploy(await governance.getAddress())) as RewardVesting;

    await rewardVesting.connect(governance).initialize(reward.address,60,300);

    await reward.connect(deployer).mint(await mockPool.getAddress(),'100000');

    await reward.connect(mockPool).approve(rewardVesting.address,'10000000000000000000000000000');
  });

  describe("set governance", () => {
    it("only allows governance", async () => {
      expect(rewardVesting.connect(player).setPendingGovernance(await newGovernance.getAddress())).revertedWith(
        "RewardVesting: only governance"
      );
    });

    context("when caller is governance", () => {
      beforeEach(async () => {
        rewardVesting = rewardVesting.connect(governance);
      });

      it("prevents getting stuck", async () => {
        expect(rewardVesting.setPendingGovernance(ZERO_ADDRESS)).revertedWith(
          "RewardVesting: pending governance address cannot be 0x0"
        );
      });

      it("sets the pending governance", async () => {
        await rewardVesting.setPendingGovernance(await newGovernance.getAddress());
        expect(await rewardVesting.governance()).equal(await governance.getAddress());
      });

      it("updates governance upon acceptance", async () => {
        await rewardVesting.setPendingGovernance(await newGovernance.getAddress());
        await rewardVesting.connect(newGovernance).acceptGovernance()
        expect(await rewardVesting.governance()).equal(await newGovernance.getAddress());
      });

      it("emits GovernanceUpdated event", async () => {
        await rewardVesting.setPendingGovernance(await newGovernance.getAddress());
        expect(rewardVesting.connect(newGovernance).acceptGovernance())
          .emit(rewardVesting, "GovernanceUpdated")
          .withArgs(await newGovernance.getAddress());
      });
    });
  });


  describe("reward vesting", () => {

    context("add earning", () => {

      it("can add earning to vestingContract", async () => {
        const EPSILON: number = 2;
        const rewardAmount: number = 50000;

        expect(await rewardVesting.duration()).equal(60);
        expect(await rewardVesting.vesting()).equal(300);

        expect(await reward.balanceOf(rewardVesting.address)).equal(0);
        await rewardVesting.connect(mockPool).addEarning(await player.getAddress(), rewardAmount);

        expect(await reward.balanceOf(rewardVesting.address)).equal(rewardAmount);
        expect(await reward.balanceOf(await mockPool.getAddress())).equal(100000 - rewardAmount);

        expect(((await rewardVesting.connect(mockPool).withdrawableEarning(await player.getAddress()))['amount'])).gte(rewardAmount/2 - EPSILON).lte(rewardAmount/2);
        expect(((await rewardVesting.connect(mockPool).withdrawableEarning(await player.getAddress()))['penaltyAmount'])).gte(rewardAmount/2).lte(rewardAmount/2 + EPSILON);

        await increaseTime(ethers.provider, 300);
        await mineBlocks(ethers.provider,1);

        expect(((await rewardVesting.connect(mockPool).withdrawableEarning(await player.getAddress()))['amount'])).gte(rewardAmount - EPSILON).lte(rewardAmount + EPSILON);
        expect(((await rewardVesting.connect(mockPool).withdrawableEarning(await player.getAddress()))['penaltyAmount'])).lte(EPSILON);
      });


      it("can add multiple rewards to vestingContract", async () => {
        const EPSILON: number = 5;
        const rewardAmount: number = 10000;

        expect(await rewardVesting.duration()).equal(60);
        expect(await rewardVesting.vesting()).equal(300);

        expect(await reward.balanceOf(rewardVesting.address)).equal(0);
        await rewardVesting.connect(mockPool).addEarning(await player.getAddress(), rewardAmount);

        expect(await reward.balanceOf(rewardVesting.address)).equal(rewardAmount);
        expect(await reward.balanceOf(await mockPool.getAddress())).equal(100000 - rewardAmount);

        expect(((await rewardVesting.connect(mockPool).withdrawableEarning(await player.getAddress()))['amount'])).gte(rewardAmount/2 - EPSILON).lte(rewardAmount/2);
        expect(((await rewardVesting.connect(mockPool).withdrawableEarning(await player.getAddress()))['penaltyAmount'])).gte(rewardAmount/2).lte(rewardAmount/2 + EPSILON);

        await increaseTime(ethers.provider, 100);
        await mineBlocks(ethers.provider,1);

        expect(((await rewardVesting.connect(mockPool).withdrawableEarning(await player.getAddress()))['amount'])).gte(rewardAmount/2 - EPSILON).lte(rewardAmount/2);
        expect(((await rewardVesting.connect(mockPool).withdrawableEarning(await player.getAddress()))['penaltyAmount'])).gte(rewardAmount/2).lte(rewardAmount/2 + EPSILON);

        expect(await reward.balanceOf(rewardVesting.address)).equal(rewardAmount);
        await rewardVesting.connect(mockPool).addEarning(await player.getAddress(), rewardAmount);

        expect(await reward.balanceOf(rewardVesting.address)).equal(rewardAmount*2);

        await increaseTime(ethers.provider, 200);
        await mineBlocks(ethers.provider,1);

        expect(((await rewardVesting.connect(mockPool).withdrawableEarning(await player.getAddress()))['amount'])).gte(3*rewardAmount/2 - EPSILON).lte(3*rewardAmount/2 + EPSILON);
        expect(((await rewardVesting.connect(mockPool).withdrawableEarning(await player.getAddress()))['penaltyAmount'])).gte(rewardAmount/2).lte(rewardAmount/2 + EPSILON);

        await increaseTime(ethers.provider, 100);
        await mineBlocks(ethers.provider,1);

        expect(((await rewardVesting.connect(mockPool).withdrawableEarning(await player.getAddress()))['amount'])).gte(2*rewardAmount - EPSILON).lte(2*rewardAmount + EPSILON);
        expect(((await rewardVesting.connect(mockPool).withdrawableEarning(await player.getAddress()))['penaltyAmount'])).lte(EPSILON);
      });

      it("can add rewards and withdraw from vestingContract", async () => {
        const EPSILON: number = 5;
        const rewardAmount: number = 10000;

        expect(await rewardVesting.duration()).equal(60);
        expect(await rewardVesting.vesting()).equal(300);

        expect(await reward.balanceOf(rewardVesting.address)).equal(0);
        await rewardVesting.connect(mockPool).addEarning(await player.getAddress(), rewardAmount);

        expect(await reward.balanceOf(rewardVesting.address)).equal(rewardAmount);
        expect(await reward.balanceOf(await mockPool.getAddress())).equal(100000 - rewardAmount);

        expect(((await rewardVesting.connect(mockPool).withdrawableEarning(await player.getAddress()))['amount'])).gte(rewardAmount/2 - EPSILON).lte(rewardAmount/2);
        expect(((await rewardVesting.connect(mockPool).withdrawableEarning(await player.getAddress()))['penaltyAmount'])).gte(rewardAmount/2).lte(rewardAmount/2 + EPSILON);

        await increaseTime(ethers.provider, 100);
        await mineBlocks(ethers.provider,1);

        expect(((await rewardVesting.connect(mockPool).withdrawableEarning(await player.getAddress()))['amount'])).gte(rewardAmount/2 - EPSILON).lte(rewardAmount/2);
        expect(((await rewardVesting.connect(mockPool).withdrawableEarning(await player.getAddress()))['penaltyAmount'])).gte(rewardAmount/2).lte(rewardAmount/2 + EPSILON);

        expect(await reward.balanceOf(rewardVesting.address)).equal(rewardAmount);
        await rewardVesting.connect(mockPool).addEarning(await player.getAddress(), rewardAmount);

        expect(await reward.balanceOf(rewardVesting.address)).equal(rewardAmount*2);

        await rewardVesting.connect(player).withdrawEarning(4999);

        expect(await reward.balanceOf(rewardVesting.address)).equal(rewardAmount*2-4999);
        expect(await reward.balanceOf(await player.getAddress())).equal(4999);

        await increaseTime(ethers.provider, 200);
        await mineBlocks(ethers.provider,1);

        expect(((await rewardVesting.connect(mockPool).withdrawableEarning(await player.getAddress()))['amount'])).gte(rewardAmount/2 - EPSILON).lte(rewardAmount/2 + EPSILON);
        expect(((await rewardVesting.connect(mockPool).withdrawableEarning(await player.getAddress()))['penaltyAmount'])).gte(rewardAmount/2).lte(rewardAmount/2 + EPSILON);

        await increaseTime(ethers.provider, 100);
        await mineBlocks(ethers.provider,1);

        expect(((await rewardVesting.connect(mockPool).withdrawableEarning(await player.getAddress()))['amount'])).gte(rewardAmount - EPSILON).lte(rewardAmount + EPSILON);
        expect(((await rewardVesting.connect(mockPool).withdrawableEarning(await player.getAddress()))['penaltyAmount'])).lte(EPSILON);
      });


    });

    context("withdraw", async () => {

      const EPSILON: number = 2;
      const rewardAmount: number = 10000;

      beforeEach(async () => {
        await rewardVesting.connect(mockPool).addEarning(await player.getAddress(), rewardAmount);
      });

      it("reverts when withdraw earning more than available", async () => {
        expect(rewardVesting.connect(player).withdrawEarning(rewardAmount))
          .revertedWith("Insufficient balance after penalty");
      });

      it("will accumulate penalty", async () => {
        // expect(((await rewardVesting.connect(mockPool).withdrawableEarning(await player.getAddress()))['amount'])).gte(rewardAmount - EPSILON).lte(rewardAmount + EPSILON);
        expect(await rewardVesting.connect(player).accumulatedPenalty()).equal(0);

        await rewardVesting.connect(player).withdrawEarning(5000);

        expect(await rewardVesting.connect(player).accumulatedPenalty()).equal(rewardAmount - 5000);

        await rewardVesting.connect(mockPool).addEarning(await player.getAddress(), 2*rewardAmount);

        await rewardVesting.connect(player).withdrawEarning(10000);

        expect(await reward.balanceOf(await player.getAddress())).equal(15000);
        expect(await rewardVesting.connect(player).accumulatedPenalty()).equal(5000+10000);
        expect(await reward.balanceOf(rewardVesting.address)).equal(5000+10000);

        expect(await reward.balanceOf(await deployer.getAddress())).equal(0);
        await rewardVesting.connect(governance).transferPenalty(await deployer.getAddress());

        expect(await reward.balanceOf(await deployer.getAddress())).equal(5000+10000);
        expect(await rewardVesting.connect(player).accumulatedPenalty()).equal(0);

      })

      it("reverts when non-owner tries to transfer penalty", async () => {
        await rewardVesting.connect(player).withdrawEarning(5000);

        expect(rewardVesting.connect(player).transferPenalty(await player.getAddress()))
          .revertedWith("RewardVesting: only governance");
      });


    });

    context("multiple player", async () => {

      it("will be correct after multiple player with multiple actions", async () => {
        await rewardVesting.connect(mockPool).addEarning(await player.getAddress(), 10000);

        await increaseTime(ethers.provider, 100);
        await mineBlocks(ethers.provider,1);

        await rewardVesting.connect(mockPool).addEarning(await player2.getAddress(), 10000);

        expect(await reward.balanceOf(rewardVesting.address)).equal(20000);

        await rewardVesting.connect(player).withdrawEarning(2500);

        expect(await rewardVesting.connect(player).accumulatedPenalty()).equal(2500);
        expect(await reward.balanceOf(await player.getAddress())).equal(2500);

        await increaseTime(ethers.provider, 200);
        await mineBlocks(ethers.provider,1);

        await rewardVesting.connect(player).withdrawEarning(5000);
        await rewardVesting.connect(player2).withdrawEarning(500);

        expect(await rewardVesting.connect(player).accumulatedPenalty()).equal(3000);
        expect(await reward.balanceOf(await player.getAddress())).equal(7500);
        expect(await reward.balanceOf(await player2.getAddress())).equal(500);

        await rewardVesting.connect(mockPool).addEarning(await player.getAddress(), 10000);
        await rewardVesting.connect(mockPool).addEarning(await player2.getAddress(), 5000);

        await increaseTime(ethers.provider, 100);
        await mineBlocks(ethers.provider,1);

        await rewardVesting.connect(player2).withdrawEarning(9000);

        expect(await reward.balanceOf(await player.getAddress())).equal(7500);

        await increaseTime(ethers.provider, 200);
        await mineBlocks(ethers.provider,1);

        await rewardVesting.connect(player).withdrawEarning(10000);
        await rewardVesting.connect(player2).withdrawEarning(5000);

        expect(await rewardVesting.connect(player).accumulatedPenalty()).equal(3000);
        expect(await reward.balanceOf(await player.getAddress())).equal(17500);
        expect(await reward.balanceOf(await player2.getAddress())).equal(14500);
      })

    })

  });
});
