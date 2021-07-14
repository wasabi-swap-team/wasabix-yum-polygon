import chai from "chai";
import chaiSubset from "chai-subset";
import {solidity} from "ethereum-waffle";
import {ethers} from "hardhat";
import {BigNumber, BigNumberish, ContractFactory, Signer} from "ethers";

import {StakingPoolsV4} from "../../types/StakingPoolsV4";
import {RewardVesting} from "../../types/RewardVesting";
import {Erc20Mock} from "../../types/Erc20Mock";
import {MAXIMUM_U256, mineBlocks,increaseTime, ZERO_ADDRESS} from "../utils/helpers";

chai.use(solidity);
chai.use(chaiSubset);

const {expect} = chai;

let StakingPoolsFactory: ContractFactory;
let RewardVestingFactory: ContractFactory;
let ERC20MockFactory: ContractFactory;

describe("StakingPools", () => {
  let deployer: Signer;
  let governance: Signer;
  let newGovernance: Signer;
  let sentinel: Signer;
  let newSentinel: Signer;
  let feeCollector: Signer;
  let signers: Signer[];

  let pools: StakingPoolsV4;
  let reward: Erc20Mock;
  let rewardVesting: RewardVesting;
  let rewardRate = 5000;

  let votingEscrow: Erc20Mock;


  before(async () => {
    StakingPoolsFactory = await ethers.getContractFactory("StakingPoolsV4");
    ERC20MockFactory = await ethers.getContractFactory("ERC20Mock");
    RewardVestingFactory = await ethers.getContractFactory("RewardVesting");
  });

  beforeEach(async () => {
    [deployer, governance, newGovernance, sentinel, newSentinel, feeCollector, ...signers] = await ethers.getSigners();

    reward = (await ERC20MockFactory.connect(deployer).deploy(
      "Test Token",
      "TEST",
      18
    )) as Erc20Mock;

    rewardVesting = (await RewardVestingFactory.connect(deployer).deploy(await governance.getAddress())) as RewardVesting;
    await rewardVesting.connect(governance).initialize(reward.address,60,300);

    votingEscrow = (await ERC20MockFactory.connect(deployer).deploy(
      "Vesting Wasabi",
      "veWASABI",
      18
    )) as Erc20Mock;

    pools = (await StakingPoolsFactory.connect(deployer).deploy(
      await governance.getAddress(),
      await sentinel.getAddress(),
      await feeCollector.getAddress())) as StakingPoolsV4;

    await pools.connect(governance).initialize(
      reward.address,
      votingEscrow.address,
      rewardVesting.address,
      true);
  });

  describe("set governance", () => {
    it("only allows governance", async () => {
      expect(pools.setPendingGovernance(await newGovernance.getAddress())).revertedWith(
        "StakingPoolsV4: only governance"
      );
    });

    context("when caller is governance", () => {
      beforeEach(async () => {
        pools = pools.connect(governance);
      });

      it("prevents getting stuck", async () => {
        expect(pools.setPendingGovernance(ZERO_ADDRESS)).revertedWith(
          "StakingPoolsV4: pending governance address cannot be 0x0"
        );
      });

      it("sets the pending governance", async () => {
        await pools.setPendingGovernance(await newGovernance.getAddress());
        expect(await pools.governance()).equal(await governance.getAddress());
      });

      it("updates governance upon acceptance", async () => {
        await pools.setPendingGovernance(await newGovernance.getAddress());
        await pools.connect(newGovernance).acceptGovernance()
        expect(await pools.governance()).equal(await newGovernance.getAddress());
      });

      it("emits GovernanceUpdated event", async () => {
        await pools.setPendingGovernance(await newGovernance.getAddress());
        expect(pools.connect(newGovernance).acceptGovernance())
          .emit(pools, "GovernanceUpdated")
          .withArgs(await newGovernance.getAddress());
      });
    });
  });

  describe("set reward rate", () => {
    let newRewardRate: BigNumberish = 100000;

    it("only allows governance to call", async () => {
      expect(pools.setRewardRate(newRewardRate)).revertedWith(
        "StakingPoolsV4: only governance"
      );
    });

    context("when caller is governance", () => {
      beforeEach(async () => (pools = pools.connect(governance)));

      it("updates reward rate", async () => {
        await pools.setRewardRate(newRewardRate);
        expect(await pools.rewardRate()).equal(newRewardRate);
      });

      it("emits RewardRateUpdated event", async () => {
        expect(pools.setRewardRate(newRewardRate))
          .emit(pools, "RewardRateUpdated")
          .withArgs(newRewardRate);
      });
    });
  });

  describe("set withdraw fee", () => {
    let newWithdrawFee: BigNumberish = 50;

    it("only allows governance to call", async () => {
      expect(pools.setWithdrawFee(newWithdrawFee)).revertedWith(
        "StakingPoolsV4: only governance"
      );
    });

    context("when caller is governance", () => {
      beforeEach(async () => (pools = pools.connect(governance)));

      it("updates withdraw fee", async () => {
        await pools.setWithdrawFee(newWithdrawFee);
        expect(await pools.withdrawFee()).equal(newWithdrawFee);
      });
    });
  });

  describe("set discount table", () => {
    let newDiscountTable: BigNumberish[] = [10,20,30,40,50,60,70,80,90];

    it("only allows governance to call", async () => {
      expect(pools.setDiscountTable(newDiscountTable)).revertedWith(
        "StakingPoolsV4: only governance"
      );
    });

    context("when caller is governance", () => {
      beforeEach(async () => (pools = pools.connect(governance)));

      it("will revert for length mismatch", async () => {
        expect(pools.setDiscountTable([1,2,3])).revertedWith(
          "StakingPoolsV4: discountTable length mismatch"
        );
      });

      it("updates discount table", async () => {
        await pools.setDiscountTable(newDiscountTable);

        expect(await pools.discountTable(0)).equal(10);
        expect(await pools.discountTable(1)).equal(20);
      });
    });
  });

  describe("set fee level", () => {
    let newFeeLevel: BigNumberish[] = [100,300,500,1000,2000,3500,6000,9000,11000];

    it("only allows governance to call", async () => {
      expect(pools.setFeeLevel(newFeeLevel)).revertedWith(
        "StakingPoolsV4: only governance"
      );
    });

    context("when caller is governance", () => {
      beforeEach(async () => (pools = pools.connect(governance)));

      it("will revert for length mismatch", async () => {
        expect(pools.setFeeLevel([1,2,3])).revertedWith(
          "StakingPoolsV4: feeLevel length mismatch"
        );
      });

      it("updates fee level", async () => {
        await pools.setFeeLevel(newFeeLevel);

        expect(await pools.feeLevel(0)).equal(100);
        expect(await pools.feeLevel(1)).equal(300);
      });
    });
  });

  describe("set pause", () => {

    it("only allows governance or sentinel to call", async () => {
      expect(pools.setPause(true)).revertedWith(
        "StakingPoolsV4: !(gov || sentinel)"
      );
      expect(await pools.pause()).equal(false);
    });

    context("when caller is governance", () => {
      beforeEach(async () => (pools = pools.connect(governance)));

      it("set pause to true", async () => {
        await pools.setPause(true);
        expect(await pools.pause()).equal(true);
      });

      it("emits PauseUpdated event", async () => {
        expect(pools.setPause(true))
          .emit(pools, "PauseUpdated")
          .withArgs(true);
      });
    });

    context("when caller is sentinel", () => {
      beforeEach(async () => (pools = pools.connect(sentinel)));

      it("set pause to true", async () => {
        await pools.setPause(true);
        expect(await pools.pause()).equal(true);
      });

      it("emits PauseUpdated event", async () => {
        expect(pools.setPause(true))
          .emit(pools, "PauseUpdated")
          .withArgs(true);
      });
    });
  });

  describe("set sentinel", () => {

    it("only allows governance to call", async () => {
      expect(pools.setSentinel(await newSentinel.getAddress())).revertedWith(
        "StakingPoolsV4: only governance"
      );
      expect(await pools.sentinel()).equal(await sentinel.getAddress());
    });

    context("when caller is governance", () => {
      beforeEach(async () => (pools = pools.connect(governance)));

      it("prevents getting stuck", async () => {
        expect(pools.setSentinel(ZERO_ADDRESS)).revertedWith(
          "StakingPoolsV4: sentinel address cannot be 0x0."
        );
      });

      it("set sentinel to new address", async () => {
        await pools.setSentinel(await newSentinel.getAddress());
        expect(await pools.sentinel()).equal(await newSentinel.getAddress());
      });

      it("emits SentinelUpdated event", async () => {
        expect(pools.setSentinel(await newSentinel.getAddress()))
          .emit(pools, "SentinelUpdated")
          .withArgs(await newSentinel.getAddress());
      });
    });
  });

  describe("set reward vesting", () => {

    it("only allows governance or sentinel to call", async () => {
      let newRewardVesting = (await RewardVestingFactory.connect(deployer).deploy(await governance.getAddress())) as RewardVesting;
      await newRewardVesting.connect(governance).initialize(reward.address,120,600);

      expect(pools.setRewardVesting(newRewardVesting.address)).revertedWith(
        "StakingPoolsV4: not paused, or not governance or sentinel"
      );
      expect(await pools.rewardVesting()).equal(rewardVesting.address);
    });

    context("when caller is governance", () => {
      beforeEach(async () => (pools = pools.connect(governance)));

      it("only allows in the pause mode", async () => {
        let newRewardVesting = (await RewardVestingFactory.connect(deployer).deploy(await governance.getAddress())) as RewardVesting;
        await newRewardVesting.connect(governance).initialize(reward.address,120,600);

        expect(pools.setRewardVesting(newRewardVesting.address)).revertedWith(
          "StakingPoolsV4: not paused, or not governance or sentinel"
        );
        expect(await pools.rewardVesting()).equal(rewardVesting.address);
      });

      it("set reward vesting to new contract", async () => {
        await pools.connect(governance).setPause(true);
        let newRewardVesting = (await RewardVestingFactory.connect(deployer).deploy(await governance.getAddress())) as RewardVesting;
        await newRewardVesting.connect(governance).initialize(reward.address,120,600);

        await pools.setRewardVesting(newRewardVesting.address);
        expect(await pools.rewardVesting()).equal(newRewardVesting.address);
      });

      it("emits RewardVestingUpdated event", async () => {
        await pools.connect(governance).setPause(true);
        let newRewardVesting = (await RewardVestingFactory.connect(deployer).deploy(await governance.getAddress())) as RewardVesting;
        await newRewardVesting.connect(governance).initialize(reward.address,120,600);

        expect(pools.setRewardVesting(newRewardVesting.address))
          .emit(pools, "RewardVestingUpdated")
          .withArgs(newRewardVesting.address);
      });
    });

    context("when caller is sentinel", () => {
      beforeEach(async () => (pools = pools.connect(sentinel)));

      it("only allows in the pause mode", async () => {
        let newRewardVesting = (await RewardVestingFactory.connect(deployer).deploy(await governance.getAddress())) as RewardVesting;
        await newRewardVesting.connect(governance).initialize(reward.address,120,600);

        expect(pools.setRewardVesting(newRewardVesting.address)).revertedWith(
          "StakingPoolsV4: not paused, or not governance or sentinel"
        );
        expect(await pools.rewardVesting()).equal(rewardVesting.address);
      });

      it("set reward vesting to new contract", async () => {
        await pools.connect(governance).setPause(true);
        let newRewardVesting = (await RewardVestingFactory.connect(deployer).deploy(await governance.getAddress())) as RewardVesting;
        await newRewardVesting.connect(governance).initialize(reward.address,120,600);

        await pools.setRewardVesting(newRewardVesting.address);
        expect(await pools.rewardVesting()).equal(newRewardVesting.address);
      });

      it("emits RewardVestingUpdated event", async () => {
        await pools.connect(governance).setPause(true);
        let newRewardVesting = (await RewardVestingFactory.connect(deployer).deploy(await governance.getAddress())) as RewardVesting;
        await newRewardVesting.connect(governance).initialize(reward.address,120,600);

        expect(pools.setRewardVesting(newRewardVesting.address))
          .emit(pools, "RewardVestingUpdated")
          .withArgs(newRewardVesting.address);
      });
    });});

  describe("create pool", () => {
    let token: Erc20Mock;
    let token2: Erc20Mock;

    beforeEach(async () => {
      token = (await ERC20MockFactory.connect(deployer).deploy(
        "Staking Token",
        "STAKE",
        18
      )) as Erc20Mock;

      token2 = (await ERC20MockFactory.connect(deployer).deploy(
        "Staking Token2",
        "STAKE2",
        18
      )) as Erc20Mock;
    });



    it("only allows governance to call", async () => {
      expect(pools.add(100,token.address,false,0,0,true,false)).revertedWith(
        "StakingPoolsV4: only governance"
      );
    });

    context("when caller is governance", async () => {
      beforeEach(async () => (pools = pools.connect(governance)));

      it("emits PoolCreated event", async () => {
        expect(pools.add(100,token.address,false,0,0,true,false))
          .emit(pools, "PoolCreated")
          .withArgs(0, token.address);
      });

      it("can add multiple pools", async () => {
        await pools.connect(governance).add(100,token.address,false,0,0,true,false);

        expect(await pools.totalAllocPoint()).equal(100);
        expect(await pools.poolLength()).equal(1);

        await pools.connect(governance).add(200,token2.address,false,0,0,true,false);

        expect(await pools.totalAllocPoint()).equal(300);
        expect(await pools.poolLength()).equal(2);

        let poolInfoData = await pools.poolInfo(1);

        expect(poolInfoData.lpToken).equal(token2.address);


      });

    });
  });

  describe("set pool reward weight ", () => {
    let token: Erc20Mock;
    let token2: Erc20Mock;

    beforeEach(async () => {
      token = (await ERC20MockFactory.connect(deployer).deploy(
        "Staking Token",
        "STAKE",
        18
      )) as Erc20Mock;

      token2 = (await ERC20MockFactory.connect(deployer).deploy(
        "Staking Token2",
        "STAKE2",
        18
      )) as Erc20Mock;

      await pools.connect(governance).add(100,token.address,false,0,0,true,false);
      await pools.connect(governance).add(200,token2.address,false,0,0,true,false);
    });



    it("only allows governance to call", async () => {
      expect(pools.connect(deployer).set(0,300,true)).revertedWith(
        "StakingPoolsV4: only governance"
      );
    });

    context("when caller is governance", async () => {
      beforeEach(async () => (pools = pools.connect(governance)));

      it("can set multiple pools", async () => {


        expect(await pools.totalAllocPoint()).equal(300);
        expect(await pools.poolLength()).equal(2);

        await pools.connect(governance).set(0,300,true);

        expect(await pools.totalAllocPoint()).equal(500);
        expect(await pools.poolLength()).equal(2);

        let poolInfoData = await pools.poolInfo(0);
        expect(poolInfoData.allocPoint).equal(300);

        await pools.connect(governance).set(1,1000,true);

        expect(await pools.totalAllocPoint()).equal(1300);
        expect(await pools.poolLength()).equal(2);

        poolInfoData = await pools.poolInfo(1);
        expect(poolInfoData.allocPoint).equal(1000);


      });

    });
  });
  //
  describe("deposit tokens", ()=>{
    let depositor: Signer;
    let depositor2: Signer;
    let token: Erc20Mock;

    let rewardWeight = 1;
    let mintAmount = 100000;
    let depositAmount = 50000;
    let rewardRate = 1000;

    beforeEach(async () => {
      [depositor,depositor2, ...signers] = signers;

      token = (await ERC20MockFactory.connect(deployer).deploy(
        "Staking Token",
        "STAKE",
        18
      )) as Erc20Mock;

      await token.connect(deployer).mint(await depositor.getAddress(), mintAmount);
      await token.connect(deployer).mint(await depositor2.getAddress(), mintAmount);
      await token.connect(depositor).approve(pools.address, MAXIMUM_U256);
      await token.connect(depositor2).approve(pools.address, MAXIMUM_U256);

      await pools.connect(governance).add(100,token.address,false,0,0,true,false);
      await pools.connect(governance).setRewardRate(rewardRate);
    });

    context('single depositor without waAsset', ()=>{
      it("has correct amount and working amount before deposit", async () => {
        let response = await pools.connect(depositor).getUserInfo(await depositor.getAddress(),0);
        expect(response[0]).equal(0);
        expect(response[1]).equal(0);
      });

      it("has correct amount and working amount after deposit", async () => {

        await pools.connect(depositor).deposit(0,depositAmount);

        let response = await pools.connect(depositor).getUserInfo(await depositor.getAddress(),0);
        expect(response[0]).equal(depositAmount);
        expect(response[1]).equal(depositAmount*0.4);


        expect((await pools.poolInfo(0)).totalDeposited).equal(depositAmount);

        expect(await token.balanceOf(await depositor.getAddress()))
          .equal(mintAmount - (depositAmount));

        expect(await token.balanceOf(pools.address))
          .equal(depositAmount);
      });

      it("has correct amount and working amount after multiple deposit", async () => {

        await pools.connect(depositor).deposit(0,10000);

        await pools.connect(depositor).deposit(0,5000);

        let response = await pools.connect(depositor).getUserInfo(await depositor.getAddress(),0);
        expect(response[0]).equal(15000);
        expect(response[1]).equal(15000*0.4);

        expect((await pools.poolInfo(0)).totalDeposited).equal(15000);

        expect(await token.balanceOf(await depositor.getAddress()))
          .equal(mintAmount - (15000));

        expect(await token.balanceOf(pools.address))
          .equal(15000);
      });
    });

    context('single depositor with waAsset', ()=>{
      it("has correct amount and working amount before deposit", async () => {
        let response = await pools.connect(depositor).getUserInfo(await depositor.getAddress(),0);
        expect(response[0]).equal(0);
        expect(response[1]).equal(0);
      });

      it("has correct amount and working amount after deposit", async () => {

        await votingEscrow.connect(deployer).mint(await depositor.getAddress(),1);

        await pools.connect(depositor).deposit(0,depositAmount);


        let response = await pools.connect(depositor).getUserInfo(await depositor.getAddress(),0);
        expect(response[0]).equal(depositAmount);
        expect(response[1]).equal(depositAmount);

        expect((await pools.poolInfo(0)).totalDeposited).equal(depositAmount);

        expect(await token.balanceOf(await depositor.getAddress()))
          .equal(mintAmount - (depositAmount));

        expect(await token.balanceOf(pools.address))
          .equal(depositAmount);
      });

      it("has correct amount and working amount after multiple deposit", async () => {

        await pools.connect(depositor).deposit(0,10000);

        let response = await pools.connect(depositor).getUserInfo(await depositor.getAddress(),0);
        expect(response[0]).equal(10000);
        expect(response[1]).equal(10000*0.4);

        await votingEscrow.connect(deployer).mint(await depositor.getAddress(),1);

        await pools.connect(depositor).deposit(0,5000);

        response = await pools.connect(depositor).getUserInfo(await depositor.getAddress(),0);
        expect(response[0]).equal(15000);
        expect(response[1]).equal(15000);

        expect((await pools.poolInfo(0)).totalDeposited).equal(15000);

        expect(await token.balanceOf(await depositor.getAddress()))
          .equal(mintAmount - (15000));

        expect(await token.balanceOf(pools.address))
          .equal(15000);
      });

      it("has correct amount and working amount after multiple deposit case 2", async () => {

        await votingEscrow.connect(deployer).mint(await depositor.getAddress(),1);
        await pools.connect(depositor).deposit(0,10000);

        let response = await pools.connect(depositor).getUserInfo(await depositor.getAddress(),0);
        expect(response[0]).equal(10000);
        expect(response[1]).equal(10000);

        await pools.connect(depositor).deposit(0,5000);

        response = await pools.connect(depositor).getUserInfo(await depositor.getAddress(),0);
        expect(response[0]).equal(15000);
        expect(response[1]).equal(15000);

        expect((await pools.poolInfo(0)).totalDeposited).equal(15000);

        expect(await token.balanceOf(await depositor.getAddress()))
          .equal(mintAmount - (15000));

        expect(await token.balanceOf(pools.address))
          .equal(15000);
      });
    });

    context('multiple depositor without waAsset', ()=>{
      it("has correct amount and working amount before deposit", async () => {
        let response = await pools.connect(depositor).getUserInfo(await depositor.getAddress(),0);
        expect(response[0]).equal(0);
        expect(response[1]).equal(0);

        response = await pools.connect(depositor).getUserInfo(await depositor2.getAddress(),0);
        expect(response[0]).equal(0);
        expect(response[1]).equal(0);
      });

      it("has correct amount and working amount after deposit", async () => {

        await pools.connect(depositor).deposit(0,depositAmount);

        let response = await pools.connect(depositor).getUserInfo(await depositor.getAddress(),0);
        expect(response[0]).equal(depositAmount);
        expect(response[1]).equal(depositAmount*0.4);

        await pools.connect(depositor2).deposit(0,depositAmount);

        response = await pools.connect(depositor).getUserInfo(await depositor2.getAddress(),0);
        expect(response[0]).equal(depositAmount);
        expect(response[1]).equal(depositAmount*0.4);

        expect((await pools.poolInfo(0)).totalDeposited).equal(depositAmount*2);

        expect(await token.balanceOf(await depositor.getAddress()))
          .equal(mintAmount - (depositAmount));

        expect(await token.balanceOf(await depositor2.getAddress()))
          .equal(mintAmount - (depositAmount));

        expect(await token.balanceOf(pools.address))
          .equal(depositAmount*2);


      });

      it("has correct amount and working amount after multiple deposit case", async () => {

        await pools.connect(depositor).deposit(0,10000);
        await pools.connect(depositor2).deposit(0,5000);
        await pools.connect(depositor).deposit(0,5000);
        await pools.connect(depositor2).deposit(0,10000);

        let response = await pools.connect(depositor).getUserInfo(await depositor.getAddress(),0);
        expect(response[0]).equal(15000);
        expect(response[1]).equal(15000*0.4);

        response = await pools.connect(depositor2).getUserInfo(await depositor2.getAddress(),0);
        expect(response[0]).equal(15000);
        expect(response[1]).equal(15000*0.4);

        expect((await pools.poolInfo(0)).totalDeposited).equal(15000*2);

        expect(await token.balanceOf(await depositor.getAddress()))
          .equal(mintAmount - (15000));

        expect(await token.balanceOf(await depositor2.getAddress()))
          .equal(mintAmount - (15000));

        expect(await token.balanceOf(pools.address))
          .equal(15000*2);
      });
    });

    context('multiple depositor with waAsset', ()=>{
      it("has correct amount and working amount before deposit", async () => {
        let response = await pools.connect(depositor).getUserInfo(await depositor.getAddress(),0);
        expect(response[0]).equal(0);
        expect(response[1]).equal(0);

        response = await pools.connect(depositor).getUserInfo(await depositor2.getAddress(),0);
        expect(response[0]).equal(0);
        expect(response[1]).equal(0);
      });

      it("has correct amount and working amount after deposit (both has waAsset)", async () => {

        await votingEscrow.connect(deployer).mint(await depositor.getAddress(),1);
        await votingEscrow.connect(deployer).mint(await depositor2.getAddress(),1);

        await pools.connect(depositor).deposit(0,depositAmount);

        let response = await pools.connect(depositor).getUserInfo(await depositor.getAddress(),0);
        expect(response[0]).equal(depositAmount);
        expect(response[1]).equal(35000);

        await pools.connect(depositor2).deposit(0,depositAmount);

        response = await pools.connect(depositor).getUserInfo(await depositor2.getAddress(),0);
        expect(response[0]).equal(depositAmount);
        expect(response[1]).equal(50000);

        expect((await pools.poolInfo(0)).totalDeposited).equal(depositAmount*2);

        expect(await token.balanceOf(await depositor.getAddress()))
          .equal(mintAmount - (depositAmount));

        expect(await token.balanceOf(await depositor2.getAddress()))
          .equal(mintAmount - (depositAmount));

        expect(await token.balanceOf(pools.address))
          .equal(depositAmount*2);


      });

      it("has correct amount and working amount after multiple deposit case one", async () => {

        await votingEscrow.connect(deployer).mint(await depositor.getAddress(),1);
        await votingEscrow.connect(deployer).mint(await depositor2.getAddress(),1);

        await pools.connect(depositor).deposit(0,5000);

        let response = await pools.connect(depositor).getUserInfo(await depositor.getAddress(),0);
        expect(response[0]).equal(5000);
        expect(response[1]).equal(3500);

        await pools.connect(depositor2).deposit(0,2000);

        response = await pools.connect(depositor2).getUserInfo(await depositor2.getAddress(),0);
        expect(response[0]).equal(2000);
        expect(response[1]).equal(2000);

        await pools.connect(depositor).deposit(0,100);

        response = await pools.connect(depositor).getUserInfo(await depositor.getAddress(),0);
        expect(response[0]).equal(5100);
        expect(response[1]).equal(4170);

        await pools.connect(depositor2).deposit(0,100);

        response = await pools.connect(depositor2).getUserInfo(await depositor2.getAddress(),0);
        expect(response[0]).equal(2100);
        expect(response[1]).equal(2100);

        expect((await pools.poolInfo(0)).totalDeposited).equal(7200);

        expect(await token.balanceOf(await depositor.getAddress()))
          .equal(mintAmount - (5100));

        expect(await token.balanceOf(await depositor2.getAddress()))
          .equal(mintAmount - (2100));

        expect(await token.balanceOf(pools.address))
          .equal(7200);

      });

      it("has correct amount and working amount after multiple deposit case two", async () => {

        await votingEscrow.connect(deployer).mint(await depositor.getAddress(),1);
        await votingEscrow.connect(deployer).mint(await depositor2.getAddress(),1);

        await pools.connect(depositor).deposit(0,5000);

        let response = await pools.connect(depositor).getUserInfo(await depositor.getAddress(),0);
        expect(response[0]).equal(5000);
        expect(response[1]).equal(3500);

        await votingEscrow.connect(deployer).mint(await depositor2.getAddress(),1);

        await pools.connect(depositor2).deposit(0,2000);

        response = await pools.connect(depositor2).getUserInfo(await depositor2.getAddress(),0);
        expect(response[0]).equal(2000);
        expect(response[1]).equal(2000);

        await votingEscrow.connect(deployer).mint(await depositor.getAddress(),2);

        await pools.connect(depositor).deposit(0,100);

        response = await pools.connect(depositor).getUserInfo(await depositor.getAddress(),0);
        expect(response[0]).equal(5100);
        expect(response[1]).equal(4596);

        await pools.connect(depositor2).deposit(0,100);

        response = await pools.connect(depositor2).getUserInfo(await depositor2.getAddress(),0);
        expect(response[0]).equal(2100);
        expect(response[1]).equal(2100);

        expect((await pools.poolInfo(0)).totalDeposited).equal(7200);

        expect(await token.balanceOf(await depositor.getAddress()))
          .equal(mintAmount - (5100));

        expect(await token.balanceOf(await depositor2.getAddress()))
          .equal(mintAmount - (2100));

        expect(await token.balanceOf(pools.address))
          .equal(7200);

      });
    })



  })

  describe("withdraw tokens", ()=>{
    let depositor: Signer;
    let depositor2: Signer;
    let token: Erc20Mock;

    let rewardWeight = 1;
    let mintAmount = 100000;
    let depositAmount = 50000;
    let withdrawAmount = 25000;
    let rewardRate = 1000;

    beforeEach(async () => {
      [depositor,depositor2, ...signers] = signers;

      token = (await ERC20MockFactory.connect(deployer).deploy(
        "Staking Token",
        "STAKE",
        18
      )) as Erc20Mock;
    });

    beforeEach(async () => (token = token.connect(depositor)));

    beforeEach(async () => {
      await token.mint(await depositor.getAddress(), mintAmount);
      await token.approve(pools.address, MAXIMUM_U256);

      await token.mint(await depositor2.getAddress(), mintAmount);
      await token.connect(depositor2).approve(pools.address, MAXIMUM_U256);
    });

    beforeEach(async () => (pools = pools.connect(governance)));

    beforeEach(async () => {
      await pools.connect(governance).add(100,token.address,true,50,60000000,true,false);
    });

    context("multiple withdraw with correct working amount", () => {
      const EPSILON: number = 5;

      let elapsedBlocks = 100;

      beforeEach(async () => {
        await pools.connect(governance).setRewardRate(rewardRate);

        await votingEscrow.connect(deployer).mint(await depositor.getAddress(),1);
        await votingEscrow.connect(deployer).mint(await depositor2.getAddress(),1);

        await pools.connect(depositor).deposit(0, depositAmount);
        await pools.connect(depositor2).deposit(0, depositAmount);

      });

      it("revert when withdraw too much", async () => {
        expect(pools.connect(depositor).withdraw(0,depositAmount+1)).revertedWith(
          "StakingPoolsV4: withdraw too much"
        );
      });

      it("get correct working amount after partial withdraw", async () => {


        let response = await pools.connect(depositor).getUserInfo(await depositor.getAddress(),0);
        expect(response[0]).equal(50000);
        expect(response[1]).equal(35000);


        response = await pools.connect(depositor2).getUserInfo(await depositor2.getAddress(),0);
        expect(response[0]).equal(50000);
        expect(response[1]).equal(50000);

        await pools.connect(depositor).withdraw(0,10000);

        response = await pools.connect(depositor).getUserInfo(await depositor.getAddress(),0);
        expect(response[0]).equal(40000);
        expect(response[1]).equal(40000);

        await pools.connect(depositor2).withdraw(0,20000);

        response = await pools.connect(depositor2).getUserInfo(await depositor2.getAddress(),0);
        expect(response[0]).equal(30000);
        expect(response[1]).equal(30000);

        expect((await pools.poolInfo(0)).totalDeposited).equal(70000);

        expect(await token.balanceOf(await depositor.getAddress()))
          .equal(mintAmount - 50000 + 10000*0.995);

        expect(await token.balanceOf(await depositor2.getAddress()))
          .equal(mintAmount - 50000 + 20000*0.995);

        expect(await token.balanceOf(pools.address))
          .equal(70000);
      });
    });

    context("early withdraw case", () => {
      const EPSILON: number = 5;

      let elapsedBlocks = 100;

      beforeEach(async () => {
        await pools.connect(governance).setRewardRate(rewardRate);
        pools = pools.connect(depositor)
        await pools.deposit(0, depositAmount);
        await mineBlocks(ethers.provider, elapsedBlocks);
        await pools.deposit(0, depositAmount);
        await mineBlocks(ethers.provider, elapsedBlocks);
        await pools.withdraw(0, depositAmount);
      });

      it("mints reward tokens", async () => {
        const rewardAmount = rewardRate * (elapsedBlocks + elapsedBlocks + 2);

        expect(await rewardVesting.userBalances(await depositor.getAddress()))
          .gte(rewardAmount - EPSILON)
          .lte(rewardAmount);
      });

      it("clears unclaimed amount", async () => {
        expect(await pools.pendingReward(0,await depositor.getAddress())).equal(0);
      });

      it("withdraws correct amount", async () => {
        let response = await pools.connect(depositor).getUserInfo(await depositor.getAddress(),0);
        expect(response[0]).equal(depositAmount);
        expect((await pools.poolInfo(0)).totalDeposited).equal(depositAmount);
      });

      it("get withdraw amount with fee deducted", async () => {
        expect(await token.balanceOf(await depositor.getAddress())).equal(0.995*depositAmount);
        expect(await token.balanceOf(await feeCollector.getAddress())).equal(0.005*depositAmount);
        expect(await token.balanceOf(pools.address)).equal(depositAmount);
      });

      it("has multiple deposit with correct lockup", async () => {
        pools = pools.connect(depositor)

        await increaseTime(ethers.provider, 10000000);
        await mineBlocks(ethers.provider, elapsedBlocks);

        await pools.withdraw(0, depositAmount);

        expect(await token.balanceOf(await depositor.getAddress())).equal(0.995*depositAmount*2);

        await pools.deposit(0, depositAmount);

        await pools.withdraw(0, depositAmount);

        expect(await token.balanceOf(await depositor.getAddress())).equal(0.995*depositAmount*2 - depositAmount + 0.995*depositAmount);
        expect(await token.balanceOf(await feeCollector.getAddress())).equal( 0.005*depositAmount + 0.005*depositAmount + 0.005*depositAmount);
      });
    });

    context("with deposit but passed lockup period", () => {
      const EPSILON: number = 5;

      let elapsedBlocks = 1000;

      beforeEach(async () => {
        await pools.connect(governance).setRewardRate(rewardRate);
        pools = pools.connect(depositor);
        await pools.deposit(0, depositAmount);
        await increaseTime(ethers.provider, 60000000);
        await mineBlocks(ethers.provider, elapsedBlocks);
        await pools.withdraw(0, depositAmount);
      });

      it("mints reward tokens", async () => {
        const rewardAmount = rewardRate * (elapsedBlocks + 1);

        expect(await rewardVesting.userBalances(await depositor.getAddress())).gte(rewardAmount - EPSILON)
        .lte(rewardAmount);
      });

      it("clears unclaimed amount", async () => {
        expect(await pools.pendingReward(0,await depositor.getAddress())).equal(0);
      });

      it("withdraws all the deposits", async () => {
        let response = await pools.connect(depositor).getUserInfo(await depositor.getAddress(),0);
        expect(response[0]).equal(0);

        expect((await pools.poolInfo(0)).totalDeposited).equal(0);
      });

      it("get all the deposits without early fee deducted but common fee deducted", async () => {
        expect(await token.balanceOf(await depositor.getAddress())).equal(mintAmount - depositAmount + depositAmount*0.995);
        expect(await token.balanceOf(await feeCollector.getAddress())).equal(depositAmount*0.005);
        expect(await token.balanceOf(pools.address)).equal(0);
      });
    });

    context("with multiple deposits passed lockup period", () => {
      const EPSILON: number = 5;

      let elapsedBlocks = 100;

      beforeEach(async () => {
        await pools.connect(governance).setRewardRate(rewardRate);
        pools = pools.connect(depositor)
        await pools.deposit(0, depositAmount);
        await mineBlocks(ethers.provider, elapsedBlocks);
        await pools.deposit(0, depositAmount);
        await increaseTime(ethers.provider, 60000000);
        await mineBlocks(ethers.provider, elapsedBlocks);
        await pools.withdraw(0, depositAmount*2);
      });

      it("mints reward tokens", async () => {
        const rewardAmount = rewardRate * (elapsedBlocks + elapsedBlocks + 2);

        expect(await rewardVesting.userBalances(await depositor.getAddress()))
          .gte(rewardAmount - EPSILON)
          .lte(rewardAmount);
      });

      it("clears unclaimed amount", async () => {
        expect(await pools.pendingReward(0,await depositor.getAddress())).equal(0);
      });

      it("withdraws all the deposits", async () => {
        let response = await pools.connect(depositor).getUserInfo(await depositor.getAddress(),0);
        expect(response[0]).equal(0);
        expect((await pools.poolInfo(0)).totalDeposited).equal(0);
      });

      it("get all the deposits without fee deducted", async () => {
        expect(await token.balanceOf(await depositor.getAddress())).equal(mintAmount*0.995);
        expect(await token.balanceOf(await feeCollector.getAddress())).equal(mintAmount*0.005);
        expect(await token.balanceOf(pools.address)).equal(0);
      });
    });

    context("with multiple deposits and will extend lockup as new deposit", () => {
      const EPSILON: number = 5;

      let elapsedBlocks = 100;

      beforeEach(async () => {
        await pools.connect(governance).setRewardRate(rewardRate);
        pools = pools.connect(depositor)
        await pools.deposit(0, depositAmount);

        await increaseTime(ethers.provider, 60000000);
        await mineBlocks(ethers.provider, elapsedBlocks);

        await pools.deposit(0, depositAmount);
        await mineBlocks(ethers.provider, elapsedBlocks);
        await pools.withdraw(0, depositAmount*2);
      });

      it("mints reward tokens", async () => {
        const rewardAmount = rewardRate * (elapsedBlocks + elapsedBlocks + 2);

        expect(await rewardVesting.userBalances(await depositor.getAddress()))
          .gte(rewardAmount - EPSILON)
          .lte(rewardAmount);
      });

      it("clears unclaimed amount", async () => {
        expect(await pools.pendingReward(0,await depositor.getAddress())).equal(0);
      });

      it("withdraws all the deposits", async () => {
        let response = await pools.connect(depositor).getUserInfo(await depositor.getAddress(),0);
        expect(response[0]).equal(0);
        expect((await pools.poolInfo(0)).totalDeposited).equal(0);
      });

      it("get all the deposits without fee deducted", async () => {
        expect(await token.balanceOf(await depositor.getAddress())).equal(mintAmount*0.995);
        expect(await token.balanceOf(await feeCollector.getAddress())).equal(mintAmount*0.005);
        expect(await token.balanceOf(pools.address)).equal(0);
      });
    });

  });

  describe("claim tokens without vesting", ()=>{
    let depositor: Signer;
    let depositor2: Signer;
    let token: Erc20Mock;

    let rewardWeight = 1;
    let mintAmount = 100000;
    let depositAmount = 50000;
    let rewardRate = 1000;
    const EPSILON: number = 2;

    beforeEach(async () => {
      [depositor,depositor2, ...signers] = signers;

      token = (await ERC20MockFactory.connect(deployer).deploy(
        "Staking Token",
        "STAKE",
        18
      )) as Erc20Mock;

      await token.connect(deployer).mint(await depositor.getAddress(), mintAmount);
      await token.connect(deployer).mint(await depositor2.getAddress(), mintAmount);
      await token.connect(depositor).approve(pools.address, MAXIMUM_U256);
      await token.connect(depositor2).approve(pools.address, MAXIMUM_U256);

      await pools.connect(governance).add(100,token.address,false,0,0,true,false);
      await pools.connect(governance).setRewardRate(rewardRate);
    });

    context('single depositor', ()=>{
      it("has zero pendingReward before deposit", async () => {
        expect(await pools.connect(depositor).pendingReward(0,await depositor.getAddress())).equal(0);
      });

      it("has correct amount after deposit", async () => {

        await votingEscrow.connect(deployer).mint(await depositor.getAddress(),1);

        await pools.connect(depositor).deposit(0,depositAmount);

        await mineBlocks(ethers.provider,10);

        expect(await pools.connect(depositor).pendingReward(0,await depositor.getAddress())).equal(10000);

        expect(await reward.connect(deployer).balanceOf(await depositor.getAddress())).equal(0);

        await pools.connect(depositor).claim(0);

        expect(await reward.connect(deployer).balanceOf(await depositor.getAddress())).equal(11000);

        expect(await reward.connect(deployer).totalSupply()).equal(11000);

        expect(await pools.connect(depositor).pendingReward(0,await depositor.getAddress())).equal(0);
      });

      it("has correct amount and working amount after multiple deposit", async () => {

        await pools.connect(depositor).deposit(0,10000);

        await mineBlocks(ethers.provider,10);

        expect(await pools.connect(depositor).pendingReward(0,await depositor.getAddress())).equal(10000);

        await votingEscrow.connect(deployer).mint(await depositor.getAddress(),1);

        await pools.connect(depositor).deposit(0,5000);

        expect(await reward.connect(deployer).balanceOf(await depositor.getAddress())).equal(12000);

        expect(await pools.connect(depositor).pendingReward(0,await depositor.getAddress())).equal(0);


        await mineBlocks(ethers.provider,5);

        expect(await pools.connect(depositor).pendingReward(0,await depositor.getAddress())).lte(5000).gte(5000-EPSILON);

        await pools.connect(depositor).claim(0);

        expect(await pools.connect(depositor).pendingReward(0,await depositor.getAddress())).equal(0);

        expect(await reward.connect(deployer).balanceOf(await depositor.getAddress())).lte(18000).gte(18000-EPSILON);;

        expect(await reward.connect(deployer).totalSupply()).lte(18000).gte(18000-EPSILON);;

      });

    });

    context('multiple depositor', ()=>{
      it("has correct zero amount before deposit", async () => {
        expect(await pools.connect(depositor).pendingReward(0,await depositor.getAddress())).equal(0);
        expect(await pools.connect(depositor2).pendingReward(0,await depositor2.getAddress())).equal(0);
      });

      it("has correct amount and working amount after deposit", async () => {

        await votingEscrow.connect(deployer).mint(await depositor.getAddress(),1);
        await votingEscrow.connect(deployer).mint(await depositor2.getAddress(),1);

        await pools.connect(depositor).deposit(0,depositAmount);

        await pools.connect(depositor2).deposit(0,depositAmount);

        expect(await pools.connect(depositor).pendingReward(0,await depositor.getAddress())).lte(1000+EPSILON).gte(1000-EPSILON);
        expect(await pools.connect(depositor2).pendingReward(0,await depositor2.getAddress())).equal(0);

        await mineBlocks(ethers.provider,10);

        expect(await pools.connect(depositor).pendingReward(0,await depositor.getAddress())).lte(5117+EPSILON).gte(5117-EPSILON);
        expect(await pools.connect(depositor2).pendingReward(0,await depositor2.getAddress())).lte(5882+EPSILON).gte(5882-EPSILON);

        await pools.connect(depositor).claim(0);

        expect(await pools.connect(depositor).pendingReward(0,await depositor.getAddress())).equal(0);

        await mineBlocks(ethers.provider,5);

        expect(await pools.connect(depositor).pendingReward(0,await depositor.getAddress())).lte(2500+EPSILON).gte(2500-EPSILON);
        expect(await pools.connect(depositor).pendingReward(0,await depositor2.getAddress())).lte(8970+EPSILON).gte(8970-EPSILON);



      });

      it("has correct amount and working amount after multiple deposit case one", async () => {

        await votingEscrow.connect(deployer).mint(await depositor.getAddress(),1);
        await votingEscrow.connect(deployer).mint(await depositor2.getAddress(),1);

        await pools.connect(depositor).deposit(0,5000);

        await pools.connect(depositor2).deposit(0,2000);

        expect(await pools.connect(depositor).pendingReward(0,await depositor.getAddress())).lte(1000+EPSILON).gte(1000-EPSILON);
        expect(await pools.connect(depositor2).pendingReward(0,await depositor2.getAddress())).equal(0);

        await mineBlocks(ethers.provider,5);

        expect(await pools.connect(depositor).pendingReward(0,await depositor.getAddress())).lte(4181+EPSILON).gte(4181-EPSILON);
        expect(await pools.connect(depositor2).pendingReward(0,await depositor2.getAddress())).lte(1818+EPSILON).gte(1818-EPSILON);

        await pools.connect(depositor).deposit(0,100);

        expect(await pools.connect(depositor).pendingReward(0,await depositor.getAddress())).equal(0);
        expect(await pools.connect(depositor2).pendingReward(0,await depositor2.getAddress())).lte(2181+EPSILON).gte(2181-EPSILON);

        await mineBlocks(ethers.provider,5);

        expect(await pools.connect(depositor).pendingReward(0,await depositor.getAddress())).lte(3379+EPSILON).gte(3379-EPSILON);
        expect(await pools.connect(depositor2).pendingReward(0,await depositor2.getAddress())).lte(3802+EPSILON).gte(3802-EPSILON);

        await pools.connect(depositor2).deposit(0,100);

        expect(await pools.connect(depositor).pendingReward(0,await depositor.getAddress())).lte(4055+EPSILON).gte(4055-EPSILON);
        expect(await pools.connect(depositor2).pendingReward(0,await depositor2.getAddress())).equal(0);

        await mineBlocks(ethers.provider,3);

        expect(await pools.connect(depositor).pendingReward(0,await depositor.getAddress())).lte(6050+EPSILON).gte(6050-EPSILON);
        expect(await pools.connect(depositor2).pendingReward(0,await depositor2.getAddress())).lte(1004+EPSILON).gte(1004-EPSILON);

        expect(await reward.connect(deployer).balanceOf(await depositor.getAddress())).lte(4818+EPSILON).gte(4818-EPSILON);
        expect(await reward.connect(deployer).balanceOf(await depositor2.getAddress())).lte(4126+EPSILON).gte(4126-EPSILON);

        expect(await reward.connect(deployer).totalSupply()).lte(13000+EPSILON).gte(13000-EPSILON);

      });

      it("has correct amount and working amount after multiple deposit case two", async () => {

        await votingEscrow.connect(deployer).mint(await depositor.getAddress(),1);
        await votingEscrow.connect(deployer).mint(await depositor2.getAddress(),1);

        await pools.connect(depositor).deposit(0,5000);

        await votingEscrow.connect(deployer).mint(await depositor2.getAddress(),1);

        await pools.connect(depositor2).deposit(0,2000);

        expect(await pools.connect(depositor).pendingReward(0,await depositor.getAddress())).lte(2000+EPSILON).gte(2000-EPSILON);
        expect(await pools.connect(depositor2).pendingReward(0,await depositor2.getAddress())).equal(0);

        await mineBlocks(ethers.provider,5);

        expect(await pools.connect(depositor).pendingReward(0,await depositor.getAddress())).lte(5181+EPSILON).gte(5181-EPSILON);
        expect(await pools.connect(depositor2).pendingReward(0,await depositor2.getAddress())).lte(1818+EPSILON).gte(1818-EPSILON);

        await votingEscrow.connect(deployer).mint(await depositor.getAddress(),2);

        await pools.connect(depositor).deposit(0,100);

        expect(await pools.connect(depositor).pendingReward(0,await depositor.getAddress())).equal(0);
        expect(await pools.connect(depositor2).pendingReward(0,await depositor2.getAddress())).lte(2545+EPSILON).gte(2545-EPSILON);

        await mineBlocks(ethers.provider,5);

        expect(await pools.connect(depositor).pendingReward(0,await depositor.getAddress())).lte(3483+EPSILON).gte(3483-EPSILON);
        expect(await pools.connect(depositor2).pendingReward(0,await depositor2.getAddress())).lte(4061+EPSILON).gte(4061-EPSILON);

        await pools.connect(depositor2).deposit(0,100);

        await mineBlocks(ethers.provider,3);

        expect(await pools.connect(depositor).pendingReward(0,await depositor.getAddress())).lte(6239+EPSILON).gte(6239-EPSILON);
        expect(await pools.connect(depositor2).pendingReward(0,await depositor2.getAddress())).lte(940+EPSILON).gte(940-EPSILON);


      });
    })
  });

  describe("claim tokens with vesting", ()=>{
    let depositor: Signer;
    let depositor2: Signer;
    let token: Erc20Mock;

    let rewardWeight = 1;
    let mintAmount = 100000;
    let depositAmount = 50000;
    let rewardRate = 1000;
    const EPSILON: number = 2;

    beforeEach(async () => {
      [depositor,depositor2, ...signers] = signers;

      token = (await ERC20MockFactory.connect(deployer).deploy(
        "Staking Token",
        "STAKE",
        18
      )) as Erc20Mock;

      await token.connect(deployer).mint(await depositor.getAddress(), mintAmount);
      await token.connect(deployer).mint(await depositor2.getAddress(), mintAmount);
      await token.connect(depositor).approve(pools.address, MAXIMUM_U256);
      await token.connect(depositor2).approve(pools.address, MAXIMUM_U256);

      await pools.connect(governance).add(100,token.address,true,0,0,true,false);
      await pools.connect(governance).setRewardRate(rewardRate);
    });

    context('single depositor', ()=>{
      it("has zero pendingReward before deposit", async () => {
        expect(await pools.connect(depositor).pendingReward(0,await depositor.getAddress())).equal(0);
      });

      it("has correct amount after deposit", async () => {

        await votingEscrow.connect(deployer).mint(await depositor.getAddress(),1);

        await pools.connect(depositor).deposit(0,depositAmount);

        await mineBlocks(ethers.provider,10);

        expect(await pools.connect(depositor).pendingReward(0,await depositor.getAddress())).equal(10000);

        expect(await rewardVesting.userBalances(await depositor.getAddress())).equal(0);

        await pools.connect(depositor).claim(0);

        expect(await rewardVesting.userBalances(await depositor.getAddress())).equal(11000);

        expect(await reward.connect(deployer).totalSupply()).equal(11000);

        expect(await pools.connect(depositor).pendingReward(0,await depositor.getAddress())).equal(0);
      });

      it("has correct amount and working amount after multiple deposit", async () => {

        await pools.connect(depositor).deposit(0,10000);

        await mineBlocks(ethers.provider,10);

        expect(await pools.connect(depositor).pendingReward(0,await depositor.getAddress())).equal(10000);

        await votingEscrow.connect(deployer).mint(await depositor.getAddress(),1);

        await pools.connect(depositor).deposit(0,5000);

        expect(await rewardVesting.userBalances(await depositor.getAddress())).equal(12000);

        expect(await pools.connect(depositor).pendingReward(0,await depositor.getAddress())).equal(0);


        await mineBlocks(ethers.provider,5);

        expect(await pools.connect(depositor).pendingReward(0,await depositor.getAddress())).lte(5000).gte(5000-EPSILON);

        await pools.connect(depositor).claim(0);

        expect(await pools.connect(depositor).pendingReward(0,await depositor.getAddress())).equal(0);

        expect(await rewardVesting.userBalances(await depositor.getAddress())).lte(18000).gte(18000-EPSILON);;

        expect(await reward.connect(deployer).totalSupply()).lte(18000).gte(18000-EPSILON);;

      });

    });

    context('multiple depositor', ()=>{
      it("has correct zero amount before deposit", async () => {
        expect(await pools.connect(depositor).pendingReward(0,await depositor.getAddress())).equal(0);
        expect(await pools.connect(depositor2).pendingReward(0,await depositor2.getAddress())).equal(0);
      });

      it("has correct amount and working amount after deposit", async () => {

        await votingEscrow.connect(deployer).mint(await depositor.getAddress(),1);
        await votingEscrow.connect(deployer).mint(await depositor2.getAddress(),1);

        await pools.connect(depositor).deposit(0,depositAmount);

        await pools.connect(depositor2).deposit(0,depositAmount);

        expect(await pools.connect(depositor).pendingReward(0,await depositor.getAddress())).lte(1000+EPSILON).gte(1000-EPSILON);
        expect(await pools.connect(depositor2).pendingReward(0,await depositor2.getAddress())).equal(0);

        await mineBlocks(ethers.provider,10);

        expect(await pools.connect(depositor).pendingReward(0,await depositor.getAddress())).lte(5117+EPSILON).gte(5117-EPSILON);
        expect(await pools.connect(depositor2).pendingReward(0,await depositor2.getAddress())).lte(5882+EPSILON).gte(5882-EPSILON);

        await pools.connect(depositor).claim(0);

        expect(await pools.connect(depositor).pendingReward(0,await depositor.getAddress())).equal(0);

        await mineBlocks(ethers.provider,5);

        expect(await pools.connect(depositor).pendingReward(0,await depositor.getAddress())).lte(2500+EPSILON).gte(2500-EPSILON);
        expect(await pools.connect(depositor).pendingReward(0,await depositor2.getAddress())).lte(8970+EPSILON).gte(8970-EPSILON);



      });

      it("has correct amount and working amount after multiple deposit case one", async () => {

        await votingEscrow.connect(deployer).mint(await depositor.getAddress(),1);
        await votingEscrow.connect(deployer).mint(await depositor2.getAddress(),1);

        await pools.connect(depositor).deposit(0,5000);

        await pools.connect(depositor2).deposit(0,2000);

        expect(await pools.connect(depositor).pendingReward(0,await depositor.getAddress())).lte(1000+EPSILON).gte(1000-EPSILON);
        expect(await pools.connect(depositor2).pendingReward(0,await depositor2.getAddress())).equal(0);

        await mineBlocks(ethers.provider,5);

        expect(await pools.connect(depositor).pendingReward(0,await depositor.getAddress())).lte(4181+EPSILON).gte(4181-EPSILON);
        expect(await pools.connect(depositor2).pendingReward(0,await depositor2.getAddress())).lte(1818+EPSILON).gte(1818-EPSILON);

        await pools.connect(depositor).deposit(0,100);

        expect(await pools.connect(depositor).pendingReward(0,await depositor.getAddress())).equal(0);
        expect(await pools.connect(depositor2).pendingReward(0,await depositor2.getAddress())).lte(2181+EPSILON).gte(2181-EPSILON);

        await mineBlocks(ethers.provider,5);

        expect(await pools.connect(depositor).pendingReward(0,await depositor.getAddress())).lte(3379+EPSILON).gte(3379-EPSILON);
        expect(await pools.connect(depositor2).pendingReward(0,await depositor2.getAddress())).lte(3802+EPSILON).gte(3802-EPSILON);

        await pools.connect(depositor2).deposit(0,100);

        expect(await pools.connect(depositor).pendingReward(0,await depositor.getAddress())).lte(4055+EPSILON).gte(4055-EPSILON);
        expect(await pools.connect(depositor2).pendingReward(0,await depositor2.getAddress())).equal(0);

        await mineBlocks(ethers.provider,3);

        expect(await pools.connect(depositor).pendingReward(0,await depositor.getAddress())).lte(6050+EPSILON).gte(6050-EPSILON);
        expect(await pools.connect(depositor2).pendingReward(0,await depositor2.getAddress())).lte(1004+EPSILON).gte(1004-EPSILON);

        expect(await rewardVesting.userBalances(await depositor.getAddress())).lte(4818+EPSILON).gte(4818-EPSILON);
        expect(await rewardVesting.userBalances(await depositor2.getAddress())).lte(4126+EPSILON).gte(4126-EPSILON);

        expect(await reward.connect(deployer).totalSupply()).lte(13000+EPSILON).gte(13000-EPSILON);

      });

      it("has correct amount and working amount after multiple deposit case two", async () => {

        await votingEscrow.connect(deployer).mint(await depositor.getAddress(),1);
        await votingEscrow.connect(deployer).mint(await depositor2.getAddress(),1);

        await pools.connect(depositor).deposit(0,5000);

        await votingEscrow.connect(deployer).mint(await depositor2.getAddress(),1);

        await pools.connect(depositor2).deposit(0,2000);

        expect(await pools.connect(depositor).pendingReward(0,await depositor.getAddress())).lte(2000+EPSILON).gte(2000-EPSILON);
        expect(await pools.connect(depositor2).pendingReward(0,await depositor2.getAddress())).equal(0);

        await mineBlocks(ethers.provider,5);

        expect(await pools.connect(depositor).pendingReward(0,await depositor.getAddress())).lte(5181+EPSILON).gte(5181-EPSILON);
        expect(await pools.connect(depositor2).pendingReward(0,await depositor2.getAddress())).lte(1818+EPSILON).gte(1818-EPSILON);

        await votingEscrow.connect(deployer).mint(await depositor.getAddress(),2);

        await pools.connect(depositor).deposit(0,100);

        expect(await pools.connect(depositor).pendingReward(0,await depositor.getAddress())).equal(0);
        expect(await pools.connect(depositor2).pendingReward(0,await depositor2.getAddress())).lte(2545+EPSILON).gte(2545-EPSILON);

        await mineBlocks(ethers.provider,5);

        expect(await pools.connect(depositor).pendingReward(0,await depositor.getAddress())).lte(3483+EPSILON).gte(3483-EPSILON);
        expect(await pools.connect(depositor2).pendingReward(0,await depositor2.getAddress())).lte(4061+EPSILON).gte(4061-EPSILON);

        await pools.connect(depositor2).deposit(0,100);

        await mineBlocks(ethers.provider,3);

        expect(await pools.connect(depositor).pendingReward(0,await depositor.getAddress())).lte(6239+EPSILON).gte(6239-EPSILON);
        expect(await pools.connect(depositor2).pendingReward(0,await depositor2.getAddress())).lte(940+EPSILON).gte(940-EPSILON);


      });
    })
  });

  describe("get stake accumulated power", () => {
    let depositor: Signer;
    let player: Signer;
    let token: Erc20Mock;

    let rewardWeight = 1;
    let depositAmount = 50000;
    let rewardRate = 5000;

    beforeEach(async () => {
      [depositor,player, ...signers] = signers;

      token = (await ERC20MockFactory.connect(deployer).deploy(
        "Staking Token",
        "STAKE",
        18
      )) as Erc20Mock;
    });

    beforeEach(async () => {
      await token.connect(depositor).mint(await depositor.getAddress(), 100000000000);
      await token.connect(depositor).approve(pools.address, MAXIMUM_U256);

      await token.connect(player).mint(await player.getAddress(), 100000000000);
      await token.connect(player).approve(pools.address, MAXIMUM_U256);
    });

    beforeEach(async () => (pools = pools.connect(governance)));

    beforeEach(async () => {
      await pools.connect(governance).add(100,token.address,true,50,60000000,true,false);
      await pools.setRewardRate(rewardRate);
    });

    context("with deposit", () => {
      const EPSILON: number = 5;


      it("properly calculates the power", async () => {
        await votingEscrow.connect(deployer).mint(await depositor.getAddress(),1);

        await pools.connect(depositor).deposit(0, depositAmount);
        await mineBlocks(ethers.provider, 10);
        await pools.connect(player).deposit(0, depositAmount);
        await mineBlocks(ethers.provider, 10);

        const rewardAmount = rewardRate * 10;

        expect(await pools.accumulatedPower(await depositor.getAddress(), 0)).gte(90714-EPSILON).lte(90714+EPSILON);
        expect(await pools.accumulatedPower(await player.getAddress(), 0)).gte(14285-EPSILON).lte(14285+EPSILON);
      });

      it("properly calculates the power after someone claim and withdraw", async () => {
        await votingEscrow.connect(deployer).mint(await depositor.getAddress(),1);

        await pools.connect(depositor).deposit(0, depositAmount);
        await mineBlocks(ethers.provider, 10);
        await pools.connect(player).deposit(0, depositAmount);
        await mineBlocks(ethers.provider, 10);
        expect(await pools.accumulatedPower(await depositor.getAddress(), 0)).gte(90714-EPSILON).lte(90714+EPSILON);
        expect(await pools.accumulatedPower(await player.getAddress(), 0)).gte(14285-EPSILON).lte(14285+EPSILON);

        await pools.connect(player).claim(0);

        expect(await pools.accumulatedPower(await depositor.getAddress(), 0)).gte(94285-EPSILON).lte(94285+EPSILON);
        expect(await pools.accumulatedPower(await player.getAddress(), 0)).gte(15714-EPSILON).lte(15714+EPSILON);

        await pools.connect(depositor).withdraw(0, depositAmount); // 85000, 30000

        expect(await pools.accumulatedPower(await depositor.getAddress(), 0)).gte(97857-EPSILON).lte(97857+EPSILON);
        expect(await pools.accumulatedPower(await player.getAddress(), 0)).gte(17142-EPSILON).lte(17142+EPSILON);

        await mineBlocks(ethers.provider, 10);

        expect(await pools.accumulatedPower(await depositor.getAddress(), 0)).gte(97857-EPSILON).lte(97857+EPSILON);
        expect(await pools.accumulatedPower(await player.getAddress(), 0)).gte(67142-EPSILON).lte(67142+EPSILON);


        expect(await pools.nextUser(0)).equal(2);
        expect(await pools.getPoolUser(0,0)).equal(await depositor.getAddress());
        expect(await pools.getPoolUser(0,1)).equal(await player.getAddress());

      });
    });
  });

  describe("withdraw fee discount", ()=>{
    let depositor: Signer;
    let token: Erc20Mock;

    let rewardWeight = 1;
    let mintAmount = 100000;
    let depositAmount = 50000;
    let withdrawAmount = 25000;
    let rewardRate = 1000;

    beforeEach(async () => {
      [depositor, ...signers] = signers;

      token = (await ERC20MockFactory.connect(deployer).deploy(
        "Staking Token",
        "STAKE",
        18
      )) as Erc20Mock;
    });

    beforeEach(async () => (token = token.connect(depositor)));

    beforeEach(async () => {
      await token.mint(await depositor.getAddress(), mintAmount);
      await token.approve(pools.address, MAXIMUM_U256);
    });

    beforeEach(async () => (pools = pools.connect(governance)));

    beforeEach(async () => {
      await pools.connect(governance).add(100,token.address,true,50,60000000,true,false);
    });

    context("withraw without any fee discount", () => {
      const EPSILON: number = 5;

      let elapsedBlocks = 1000;

      beforeEach(async () => {
        await pools.connect(governance).setRewardRate(rewardRate);
        pools = pools.connect(depositor);
        await pools.deposit(0, depositAmount);
        await increaseTime(ethers.provider, 60000000);
        await mineBlocks(ethers.provider, elapsedBlocks);
        await pools.withdraw(0, depositAmount);
      });

      it("mints reward tokens", async () => {
        const rewardAmount = rewardRate * (elapsedBlocks + 1);

        expect(await rewardVesting.userBalances(await depositor.getAddress())).gte(rewardAmount - EPSILON)
        .lte(rewardAmount);
      });

      it("clears unclaimed amount", async () => {
        expect(await pools.pendingReward(0,await depositor.getAddress())).equal(0);
      });

      it("withdraws all the deposits", async () => {
        let response = await pools.connect(depositor).getUserInfo(await depositor.getAddress(),0);
        expect(response[0]).equal(0);

        expect((await pools.poolInfo(0)).totalDeposited).equal(0);
      });

      it("get all the deposits with common fee deducted", async () => {
        expect(await token.balanceOf(await depositor.getAddress())).equal(mintAmount - depositAmount + depositAmount*0.995);
        expect(await token.balanceOf(await feeCollector.getAddress())).equal(depositAmount*0.005);
        expect(await token.balanceOf(pools.address)).equal(0);
      });
    });

    context("withraw with vewasabi fee discount", () => {
      const EPSILON: number = 5;

      let elapsedBlocks = 1000;

      beforeEach(async () => {
        await pools.connect(governance).setRewardRate(rewardRate);
        pools = pools.connect(depositor);
        await pools.deposit(0, depositAmount);
        await increaseTime(ethers.provider, 60000000);
        await mineBlocks(ethers.provider, elapsedBlocks);

      });

      it("discount 10% for 50 veWasabi", async ()=> {
        await votingEscrow.connect(deployer).mint(await depositor.getAddress(),"51000000000000000000");
        await pools.withdraw(0, depositAmount);

        expect(await token.balanceOf(await depositor.getAddress())).equal(99775);
        expect(await token.balanceOf(await feeCollector.getAddress())).equal(225);
        expect(await token.balanceOf(pools.address)).equal(0);
      })

      it("discount 50% for 2000 veWasabi", async ()=> {
        await votingEscrow.connect(deployer).mint(await depositor.getAddress(),"2000000000000000000000");
        await pools.withdraw(0, depositAmount);

        expect(await token.balanceOf(await depositor.getAddress())).equal(mintAmount - depositAmount + depositAmount - 125);
        expect(await token.balanceOf(await feeCollector.getAddress())).equal(125);
        expect(await token.balanceOf(pools.address)).equal(0);
      })

      it("discount 91% for 11000 veWasabi", async ()=> {
        await votingEscrow.connect(deployer).mint(await depositor.getAddress(),"12000000000000000000000");
        await pools.withdraw(0, depositAmount);

        expect(await token.balanceOf(await depositor.getAddress())).equal(mintAmount - depositAmount + depositAmount - 22);
        expect(await token.balanceOf(await feeCollector.getAddress())).equal(22);
        expect(await token.balanceOf(pools.address)).equal(0);
      })

    });

  })

});
