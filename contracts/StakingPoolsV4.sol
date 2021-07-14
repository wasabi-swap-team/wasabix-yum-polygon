// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.6.0;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IMintableERC20} from "./interfaces/IMintableERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {SafeMath} from "@openzeppelin/contracts/math/SafeMath.sol";
import {Math} from "@openzeppelin/contracts/math/Math.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import {IRewardVesting} from "./interfaces/IRewardVesting.sol";
import {IVotingEscrow} from "./interfaces/IVotingEscrow.sol";

import "hardhat/console.sol";

contract StakingPoolsV4 is ReentrancyGuard {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    // Info of each user.
    struct UserInfo {
        uint256 amount;     // How many LP tokens the user has provided.
        uint256 workingAmount; // actual amount * ve boost * lockup bonus
        uint256 rewardDebt; // Reward debt.
        uint256 power;
    }

    // Info of each pool.
    struct PoolInfo {
        IERC20 lpToken;           // Address of LP token contract.
        uint256 allocPoint;       // How many allocation points assigned to this pool.
        uint256 lastRewardBlock;   // Last block number that Wasabi distribution occurs.
        uint256 accRewardPerShare;  // Accumulated Wasabi per share, times 1e18. See below.
        uint256 workingSupply;    // Total supply of working amount
        uint256 totalDeposited;
        bool needVesting;
        uint256 earlyWithdrawFee; // divided by 10000
        uint256 withdrawLock; // in second
        bool veBoostEnabled;

        mapping (address => UserInfo) userInfo;
    }

    /// @dev A mapping of all of the user deposit time mapped first by pool and then by address.
    mapping(address => mapping(uint256 => uint256)) private _depositedAt;

    /// @dev A mapping of userIsKnown mapped first by pool and then by address.
    mapping(address => mapping(uint256 => bool)) public userIsKnown;

    /// @dev A mapping of userAddress mapped first by pool and then by nextUser.
    mapping(uint256 => mapping(uint256 => address)) public userList;

    /// @dev index record next user index mapped by pool
    mapping(uint256 => uint256) public nextUser;

    // The Wasabi TOKEN!
    IMintableERC20 public reward;

    /// @dev The address of reward vesting.
    IRewardVesting public rewardVesting;

    IVotingEscrow public veWasabi;

    uint256 public rewardRate;

    // Info of each pool.
    PoolInfo[] public poolInfo;
    // Total allocation points. Must be the sum of all allocation points in all pools.
    uint256 public totalAllocPoint = 0;

    bool public mintWasabi;

    uint256[] public feeLevel; // fixed length = 9 (unit without 10^18); [50,200,500,1000,2000,3500,6000,9000,11000]
    uint256[] public discountTable; // fixed length = 9; [9,19,28,40,50,60,70,80,90]
    uint256 public withdrawFee;


    uint256 private constant hundred = 100;

    /// @dev The address of the account which currently has administrative capabilities over this contract.
    address public governance;

    address public pendingGovernance;

    /// @dev The address of the account which can perform emergency activities
    address public sentinel;

    address public withdrawFeeCollector;

    bool public pause;


    event PoolCreated(
      uint256 indexed poolId,
      IERC20 indexed token
    );

    event Deposit(address indexed user, uint256 indexed pid, uint256 amount);
    event Withdraw(address indexed user, uint256 indexed pid, uint256 amount);
    event Claim(address indexed user, uint256 indexed pid, uint256 amount);
    event WorkingAmountUpdate(
        address indexed user,
        uint256 indexed pid,
        uint256 newWorkingAmount,
        uint256 newWorkingSupply
    );

    event PendingGovernanceUpdated(
      address pendingGovernance
    );

    event GovernanceUpdated(
      address governance
    );

    event WithdrawFeeCollectorUpdated(
      address withdrawFeeCollector
    );

    event RewardVestingUpdated(
      IRewardVesting rewardVesting
    );

    event PauseUpdated(
      bool status
    );

    event SentinelUpdated(
      address sentinel
    );

    event RewardRateUpdated(
      uint256 rewardRate
    );

    // solium-disable-next-line
    constructor(address _governance, address _sentinel,address _withdrawFeeCollector) public {
      require(_governance != address(0), "StakingPoolsV4: governance address cannot be 0x0");
      require(_sentinel != address(0), "StakingPoolsV4: sentinel address cannot be 0x0");
      require(_withdrawFeeCollector != address(0), "StakingPoolsV4: withdrawFee collector address cannot be 0x0");
      governance = _governance;
      sentinel = _sentinel;
      withdrawFeeCollector = _withdrawFeeCollector;
      feeLevel = [50,200,500,1000,2000,3500,6000,9000,11000];
      discountTable = [10,20,30,40,50,60,72,81,91];
      withdrawFee = 50;

    }

    modifier onlyGovernance() {
      require(msg.sender == governance, "StakingPoolsV4: only governance");
      _;
    }

    ///@dev modifier add users to userlist. Users are indexed in order to keep track of
    modifier checkIfNewUser(uint256 pid) {
        if (!userIsKnown[msg.sender][pid]) {
            userList[nextUser[pid]][pid] = msg.sender;
            userIsKnown[msg.sender][pid] = true;
            nextUser[pid]++;
        }
        _;
    }

    function initialize(
        IMintableERC20 _rewardToken,
        IVotingEscrow _veWasabi,
        IRewardVesting _rewardVesting,
        bool _mintWasabi
    )
        external
        onlyGovernance
    {
        reward = _rewardToken;
        veWasabi = _veWasabi;
        rewardVesting = _rewardVesting;
        mintWasabi = _mintWasabi;

    }

    function setPendingGovernance(address _pendingGovernance) external onlyGovernance {
      require(_pendingGovernance != address(0), "StakingPoolsV4: pending governance address cannot be 0x0");
      pendingGovernance = _pendingGovernance;

      emit PendingGovernanceUpdated(_pendingGovernance);
    }

    function acceptGovernance() external {
      require(msg.sender == pendingGovernance, "StakingPoolsV4: only pending governance");

      address _pendingGovernance = pendingGovernance;
      governance = _pendingGovernance;

      emit GovernanceUpdated(_pendingGovernance);
    }

    function poolLength() external view returns (uint256) {
        return poolInfo.length;
    }

    // Add a new lp to the pool. Can only be called by the owner.
    // XXX DO NOT add the same LP token more than once. Rewards will be messed up if you do.
    function add(
        uint256 _allocPoint,
        IERC20 _lpToken,
        bool _needVesting,
        uint256 _earlyWithdrawFee,
        uint256 _withdrawLock,
        bool _veBoostEnabled,
        bool _withUpdate
    )
        public
        onlyGovernance
    {
        if (_withUpdate) {
            massUpdatePools();
        }

        uint256 poolId = poolInfo.length;
        uint256 lastRewardBlock = block.number;
        totalAllocPoint = totalAllocPoint.add(_allocPoint);
        poolInfo.push(PoolInfo({
            lpToken: _lpToken,
            allocPoint: _allocPoint,
            lastRewardBlock: lastRewardBlock,
            accRewardPerShare: 0,
            workingSupply: 0,
            totalDeposited: 0,
            needVesting:_needVesting,
            earlyWithdrawFee:_earlyWithdrawFee,
            withdrawLock:_withdrawLock,
            veBoostEnabled:_veBoostEnabled
        }));


        emit PoolCreated(poolId, _lpToken);
    }

    // Update the given pool's SMTY allocation point. Can only be called by the owner.
    function set(
        uint256 _pid,
        uint256 _allocPoint,
        bool _withUpdate
    )
        public
        onlyGovernance
    {
        if (_withUpdate) {
            massUpdatePools();
        }
        totalAllocPoint = totalAllocPoint.sub(poolInfo[_pid].allocPoint).add(_allocPoint);
        poolInfo[_pid].allocPoint = _allocPoint;
    }

    function setRewardRate(uint256 _rewardRate) external onlyGovernance {
      massUpdatePools();

      rewardRate = _rewardRate;

      emit RewardRateUpdated(_rewardRate);
    }

    // Return block rewards over the given _from (inclusive) to _to (inclusive) block.
    function getBlockReward(uint256 _from, uint256 _to) public view returns (uint256) {
        uint256 to = _to;
        uint256 from = _from;

        if (from > to) {
            return 0;
        }


        uint256 rewardPerBlock = rewardRate;
        uint256 totalRewards = (to.sub(from)).mul(rewardPerBlock);

        return totalRewards;
    }

    // View function to see pending SMTYs on frontend.
    function pendingReward(uint256 _pid, address _user) external view returns (uint256) {
        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = pool.userInfo[_user];
        uint256 accRewardPerShare = pool.accRewardPerShare;
        uint256 workingSupply = pool.workingSupply;
        if (block.number > pool.lastRewardBlock && workingSupply != 0) {
            uint256 wasabiReward = getBlockReward(pool.lastRewardBlock, block.number).mul(
                pool.allocPoint).div(totalAllocPoint);
            accRewardPerShare = accRewardPerShare.add(wasabiReward.mul(1e18).div(workingSupply));
        }
        return user.workingAmount.mul(accRewardPerShare).div(1e18).sub(user.rewardDebt);
    }

    // View Accumulated Power
    function accumulatedPower(address _user, uint256 _pid) external view returns (uint256) {
        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = pool.userInfo[_user];
        uint256 accRewardPerShare = pool.accRewardPerShare;
        uint256 workingSupply = pool.workingSupply;
        if (block.number > pool.lastRewardBlock && workingSupply != 0) {
            uint256 wasabiReward = getBlockReward(pool.lastRewardBlock, block.number).mul(
                pool.allocPoint).div(totalAllocPoint);
            accRewardPerShare = accRewardPerShare.add(wasabiReward.mul(1e18).div(workingSupply));
        }
        return user.power.add(user.workingAmount.mul(accRewardPerShare).div(1e18).sub(user.rewardDebt));
    }

    function getPoolUser(uint256 _poolId, uint256 _userIndex) external view returns (address) {
      return userList[_userIndex][_poolId];
    }

    // Update reward variables for all pools. Be careful of gas spending!
    function massUpdatePools() public {
        uint256 length = poolInfo.length;
        for (uint256 pid = 0; pid < length; ++pid) {
            updatePool(pid);
        }
    }

    // Update reward variables of the given pool to be up-to-date.
    function updatePool(uint256 _pid) public {
        _updatePool(_pid);
    }

    function _updatePool(uint256 _pid) internal {
        PoolInfo storage pool = poolInfo[_pid];
        if (block.number <= pool.lastRewardBlock) {
            return;
        }
        uint256 workingSupply = pool.workingSupply;
        if (workingSupply == 0) {
            pool.lastRewardBlock = block.number;
            return;
        }
        uint256 wasabiReward = getBlockReward(pool.lastRewardBlock, block.number).mul(
            pool.allocPoint).div(totalAllocPoint);
        if (mintWasabi) {
            reward.mint(address(this), wasabiReward);
        }
        pool.accRewardPerShare = pool.accRewardPerShare.add(wasabiReward.mul(1e18).div(workingSupply));

        pool.lastRewardBlock = block.number;
    }

    modifier claimReward(uint256 _pid, address _account) {
        require(!pause, "StakingPoolsV4: emergency pause enabled");

        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = pool.userInfo[_account];
        _updatePool(_pid);

        if (user.workingAmount > 0) {
          uint256 rewardPending = user.workingAmount.mul(pool.accRewardPerShare).div(1e18).sub(user.rewardDebt);
          if(pool.needVesting){
            reward.approve(address(rewardVesting),uint(-1));
            rewardVesting.addEarning(_account,rewardPending);
          } else {
            safeWasabiTransfer(_account, rewardPending);
          }
          user.power = user.power.add(rewardPending);
        }

        _; // amount/boost may be changed

        _updateWorkingAmount(_pid, _account);
        user.rewardDebt = user.workingAmount.mul(pool.accRewardPerShare).div(1e18);
    }

    function _updateWorkingAmount(
        uint256 _pid,
        address _account
    ) internal
    {
        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = pool.userInfo[_account];

        uint256 lim = user.amount.mul(4).div(10);

        uint256 votingBalance = veWasabi.balanceOf(_account);
        uint256 totalBalance = veWasabi.totalSupply();

        if (totalBalance != 0 && pool.veBoostEnabled) {
            uint256 lsupply = pool.totalDeposited;
            lim = lim.add(lsupply.mul(votingBalance).div(totalBalance).mul(6).div(10));
        }

        uint256 veAmount = Math.min(user.amount, lim);

        pool.workingSupply = pool.workingSupply.sub(user.workingAmount).add(veAmount);
        user.workingAmount = veAmount;

        emit WorkingAmountUpdate(_account, _pid, user.workingAmount, pool.workingSupply);
    }

    /*
     * Deposit without lock.
     */
    function deposit(uint256 _pid, uint256 _amount) external nonReentrant claimReward(_pid, msg.sender) checkIfNewUser(_pid) {
        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = pool.userInfo[msg.sender];

        if (_amount > 0) {
            _depositedAt[msg.sender][_pid] = block.timestamp;
            pool.lpToken.safeTransferFrom(address(msg.sender), address(this), _amount);
            user.amount = user.amount.add(_amount);
            pool.totalDeposited = pool.totalDeposited.add(_amount);
        }

        emit Deposit(msg.sender, _pid, _amount);
    }


    function setFeeLevel(uint256[] calldata _feeLevel) external onlyGovernance {
      require(_feeLevel.length == 9, "StakingPoolsV4: feeLevel length mismatch");
      feeLevel = _feeLevel;
    }

    function setDiscountTable(uint256[] calldata _discountTable) external onlyGovernance {
      require(_discountTable.length == 9, "StakingPoolsV4: discountTable length mismatch");
      discountTable = _discountTable;
    }

    function setWithdrawFee(uint256 _withdrawFee) external onlyGovernance {
      withdrawFee = _withdrawFee;
    }

    function withdraw(uint256 _pid, uint256 amount) external nonReentrant {
      _withdraw(_pid, amount);
    }

    function _withdraw(uint256 _pid, uint256 amount) internal claimReward(_pid, msg.sender) {
        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = pool.userInfo[msg.sender];

        require(amount <= user.amount, "StakingPoolsV4: withdraw too much");

        pool.totalDeposited = pool.totalDeposited.sub(amount);
        user.amount = user.amount - amount;

        uint256 withdrawPenalty = 0;
        uint256 finalizedAmount = amount;
        uint256 depositTimestamp = _depositedAt[msg.sender][_pid];

        if (depositTimestamp.add(pool.withdrawLock) > block.timestamp) {
          withdrawPenalty = amount.mul(pool.earlyWithdrawFee).div(10000);

          pool.lpToken.safeTransfer(withdrawFeeCollector, withdrawPenalty);
          finalizedAmount = finalizedAmount.sub(withdrawPenalty);
        } else {
          uint256 votingBalance = veWasabi.balanceOf(msg.sender);
          withdrawPenalty = amount.mul(withdrawFee).div(10000);


          for (uint256 i = 0; i < 9; ++i) {
            if(votingBalance >= (feeLevel[i]).mul(1 ether)){
              withdrawPenalty = amount.mul(withdrawFee).div(10000);
              withdrawPenalty = withdrawPenalty.mul(hundred.sub(discountTable[i])).div(hundred);
            }
          }
          pool.lpToken.safeTransfer(withdrawFeeCollector, withdrawPenalty);
          finalizedAmount = finalizedAmount.sub(withdrawPenalty);
        }

        pool.lpToken.safeTransfer(msg.sender, finalizedAmount);

        emit Withdraw(msg.sender, _pid, amount);
    }

    // solium-disable-next-line
    function claim(uint256 _pid) external nonReentrant claimReward(_pid, msg.sender) {
    }

    // Safe smty transfer function, just in case if rounding error causes pool to not have enough SMTYs.
    function safeWasabiTransfer(address _to, uint256 _amount) internal {
        if (_amount > 0) {
            uint256 wasabiBal = reward.balanceOf(address(this));
            if (_amount > wasabiBal) {
                reward.transfer(_to, wasabiBal);
            } else {
                reward.transfer(_to, _amount);
            }
        }
    }

    function getUserInfo(address _account, uint256 _poolId) public view returns(uint, uint, uint) {
        PoolInfo storage pool = poolInfo[_poolId];
        UserInfo storage user = pool.userInfo[_account];

        return (user.amount, user.workingAmount, user.rewardDebt);
    }

    function getDepositedAt(address _account, uint256 _poolId) external view returns (uint256) {
      return _depositedAt[_account][_poolId];
    }

    /// @dev Updates the reward vesting contract
    ///
    /// @param _rewardVesting the new reward vesting contract
    function setRewardVesting(IRewardVesting _rewardVesting) external {
      require(pause && (msg.sender == governance || msg.sender == sentinel), "StakingPoolsV4: not paused, or not governance or sentinel");
      rewardVesting = _rewardVesting;
      emit RewardVestingUpdated(_rewardVesting);
    }

    /// @dev Sets the address of the sentinel
    ///
    /// @param _sentinel address of the new sentinel
    function setSentinel(address _sentinel) external onlyGovernance {
        require(_sentinel != address(0), "StakingPoolsV4: sentinel address cannot be 0x0.");
        sentinel = _sentinel;
        emit SentinelUpdated(_sentinel);
    }

    /// @dev Sets if the contract should enter emergency pause mode.
    ///
    /// There are 2 main reasons to pause:
    ///     1. Need to shut down claims in case of any issues in the reward vesting contract
    ///     2. Need to migrate to a new reward vesting contract
    ///
    /// While this contract is paused, claim is disabled
    ///
    /// @param _pause if the contract should enter emergency pause mode.
    function setPause(bool _pause) external {
        require(msg.sender == governance || msg.sender == sentinel, "StakingPoolsV4: !(gov || sentinel)");
        pause = _pause;
        emit PauseUpdated(_pause);
    }

    function setWithdrawFeeCollector(address _newWithdrawFeeCollector) external onlyGovernance {
        require(_newWithdrawFeeCollector != address(0), "StakingPoolsV4: withdrawFeeCollector address cannot be 0x0.");
        withdrawFeeCollector = _newWithdrawFeeCollector;
        emit WithdrawFeeCollectorUpdated(_newWithdrawFeeCollector);
    }
}
