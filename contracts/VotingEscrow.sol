// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.6.12;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import {IMintableERC20} from "./interfaces/IMintableERC20.sol";
import {IRewardVesting} from "./interfaces/IRewardVesting.sol";
import "hardhat/console.sol";

contract VotingEscrow is IERC20 {

    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    IMintableERC20 public wasabi;

    address[] public rewardTokens;
    /// @dev A mapping of all added reward tokens.
    mapping(address => bool) public rewardTokensList;
    /// @dev A mapping of the need vesting boolean mapped by reward token.
    mapping(address => bool) public rewardsNeedVesting;
    /// @dev A mapping of the vesting contract mapped by reward token.
    mapping(address => address) public rewardVestingsList;
   
    address public collector;

    /// @dev The address of the account which currently has administrative capabilities over this contract.
    address public governance;
    address public pendingGovernance;
    /// @dev A flag indicating if the contract has been initialized yet.
    bool public initialized;

    uint256 private _totalSupply;
    mapping (address => uint256) private _balances;
    string private _name;
    string private _symbol;
    uint8 private _decimals;

    uint256 public constant MAX_TIME = 1440 days;

    enum LockDays { ONEWEEK,ONEMONTH,THREEMONTH,SIXMONTH,ONEYEAR,FOURYEAR}
    enum ExtendDays { ONEWEEK,ONEMONTH,THREEMONTH,SIXMONTH,ONEYEAR,FOURYEAR }
    mapping (LockDays => uint256) private _lockDays;
    mapping (ExtendDays => uint256) private _extendDays;

    struct LockData {
        uint256 amount;
        uint256 start;
        uint256 end;
    }
    mapping (address => LockData) private _locks;
    uint256 public totalLockedWASABI;

    uint256 public wasabiRewardRate;
    bool public wasabiNeedVesting;
    address public wasabiVestingAddress;
    uint256 lastRewardBlock; //Last block number that Wasabi distribution occurs.
    uint256 private _accWasabiRewardPerBalance;
    mapping (address => uint256) private _wasabiRewardDebts;


    mapping (address => uint256) private _accRewardPerBalance;
    /// @dev A mapping of all of the user reward debt mapped first by reward token and then by address.
    mapping(address => mapping(address => uint256)) private _rewardDebt;

    event LockCreate(address indexed user, uint256 amount, uint256 veAmount, uint256 lockStart, uint256 lockEnd);
    event LockExtend(address indexed user, uint256 amount, uint256 veAmount, uint256 lockStart, uint256 lockEnd);
    event LockIncreaseAmount(address indexed user, uint256 amount, uint256 veAmount, uint256 lockStart, uint256 lockEnd);
    event Withdraw(address indexed user, uint256 amount);
    event PendingGovernanceUpdated(address pendingGovernance);
    event GovernanceUpdated(address governance);
    event RewardTokenAdded(address rewardToken, address rewardVesting, bool needVesting);
    event RewardTokenUpdated(address rewardToken, address rewardVesting, bool needVesting);
    event CollectorUpdated(address collector);
    event WasabiRewardRateUpdated(uint256 wasabiRewardRate);
    event WasabiVestingUpdated(bool needVesting, address vestingAddress);

    // solium-disable-next-line
    constructor(address _governance) public {
        require(_governance != address(0), "VotingEscrow: governance address cannot be 0x0");
        governance = _governance;
    }

    /*
     * Owner methods
     */
    function initialize(IMintableERC20 _wasabi,
                        uint256 _wasabiRewardRate, bool _wasabiNeedVesting, address _wasabiVestingAddress,
                        address[] memory _rewardTokens, address[] memory _rewardVestings, bool[] memory _needVestings,
                        address _collector) external onlyGovernance {
        require(!initialized, "VotingEscrow: already initialized");
        require(_rewardTokens.length == _rewardVestings.length, "VotingEscrow: reward token and reward vesting length mismatch");
        require(_rewardTokens.length == _needVestings.length, "VotingEscrow: reward token and need vesting length mismatch");
        require(_collector != address(0), "VotingEscrow: collector address cannot be 0x0");

        if (_wasabiNeedVesting) {
            require(_wasabiVestingAddress != address(0), "VotingEscrow: wasabi vesting contract address cannot be 0x0 if wasabi requires vesting");
        }

        _name = "Voting Escrow Wasabi Token";
        _symbol = "veWasabi";
        _decimals = 18;
        wasabi = _wasabi;
        wasabiRewardRate = _wasabiRewardRate;
        wasabiNeedVesting = _wasabiNeedVesting;
        wasabiVestingAddress = _wasabiVestingAddress;

        for (uint i=0; i<_rewardTokens.length; i++) {
            address rewardToken = _rewardTokens[i];
            bool needVesting = _needVestings[i];
            address rewardVesting = _rewardVestings[i];
            if (!rewardTokensList[rewardToken]) {
                rewardTokensList[rewardToken] = true;
                rewardTokens.push(rewardToken);
                rewardsNeedVesting[rewardToken] = needVesting;
                if (needVesting) {
                    require(rewardVesting != address(0), "VotingEscrow: reward vesting contract address cannot be 0x0");
                }
                rewardVestingsList[rewardToken] = rewardVesting;
            }
        }

        collector = _collector;
        initialized = true;
        lastRewardBlock = block.number;

        _lockDays[LockDays.ONEWEEK] = 7 days;
        _lockDays[LockDays.ONEMONTH] = 30 days;
        _lockDays[LockDays.THREEMONTH] = 90 days;
        _lockDays[LockDays.SIXMONTH] = 180 days;
        _lockDays[LockDays.ONEYEAR] = 360 days;
        _lockDays[LockDays.FOURYEAR] = 1440 days;

        _extendDays[ExtendDays.ONEWEEK] = 7 days;
        _extendDays[ExtendDays.ONEMONTH] = 30 days;
        _extendDays[ExtendDays.THREEMONTH] = 90 days;
        _extendDays[ExtendDays.SIXMONTH] = 180 days;
        _extendDays[ExtendDays.ONEYEAR] = 360 days;
        _extendDays[ExtendDays.FOURYEAR] = 1440 days;
    }

    /// @dev Checks that the contract is in an initialized state.
    ///
    /// This is used over a modifier to reduce the size of the contract
    modifier expectInitialized() {
        require(initialized, "VotingEscrow: not initialized.");
        _;
    }

    modifier onlyGovernance() {
        require(msg.sender == governance, "VotingEscrow: only governance");
        _;
    }

    /// @dev Sets the governance.
    ///
    /// This function can only called by the current governance.
    ///
    /// @param _pendingGovernance the new pending governance.
    function setPendingGovernance(address _pendingGovernance) external onlyGovernance {
        require(_pendingGovernance != address(0), "VotingEscrow: pending governance address cannot be 0x0");
        pendingGovernance = _pendingGovernance;

        emit PendingGovernanceUpdated(_pendingGovernance);
    }

    function acceptGovernance() external {
        require(msg.sender == pendingGovernance, "VotingEscrow: only pending governance");

        address _pendingGovernance = pendingGovernance;
        governance = _pendingGovernance;

        emit GovernanceUpdated(_pendingGovernance);
    }

    /// @dev Sets the address of the collector
    ///
    /// @param _collector address of the new collector
    function setCollector(address _collector) external onlyGovernance {
        require(_collector != address(0), "VotingEscrow: collector address cannot be 0x0.");
        collector = _collector;
        emit CollectorUpdated(_collector);
    }

    function setRewardToken(address _rewardToken, address _rewardVesting, bool _needVesting) external onlyGovernance expectInitialized {
        require(_rewardToken != address(0), "VotingEscrow: new reward token address cannot be 0x0");

        if (_needVesting) {
            require(_rewardVesting != address(0), "VotingEscrow: new reward vesting address cannot be 0x0");
        }

        if (!rewardTokensList[_rewardToken]) {
            rewardTokens.push(_rewardToken);
            rewardTokensList[_rewardToken] = true;
            rewardsNeedVesting[_rewardToken] = _needVesting;
            rewardVestingsList[_rewardToken] = _rewardVesting;
            emit RewardTokenAdded(_rewardToken, _rewardVesting, _needVesting);
        } else {
            rewardsNeedVesting[_rewardToken] = _needVesting;
            rewardVestingsList[_rewardToken] = _rewardVesting;
            emit RewardTokenUpdated(_rewardToken, _rewardVesting, _needVesting);
        }
    }

    function setWasabiRewardRate(uint256 _wasabiRewardRate) external onlyGovernance {
        collectReward();
        wasabiRewardRate = _wasabiRewardRate;
        emit WasabiRewardRateUpdated(_wasabiRewardRate);
    }

    function setWasabiVesting(bool _needVesting, address _vestingAddress) external onlyGovernance {
        if (_needVesting) {
            require(_vestingAddress != address(0), "VotingEscrow: new wasabi reward vesting address cannot be 0x0");
        }

        wasabiNeedVesting = _needVesting;
        wasabiVestingAddress = _vestingAddress;
        emit WasabiVestingUpdated(_needVesting, _vestingAddress);
    }

    // veWasabi ERC20 interface
    function name() public view virtual returns (string memory) {
        return _name;
    }

    function symbol() public view virtual returns (string memory) {
        return _symbol;
    }

    function decimals() public view virtual returns (uint8) {
        return _decimals;
    }

    function totalSupply() public view virtual override returns (uint256) {
        return _totalSupply;
    }

    function balanceOf(address account) public view virtual override returns (uint256) {
        return _balances[account];
    }

    function transfer(address recipient, uint256 amount) public virtual override returns (bool) {
        return false;
    }

    function allowance(
        address owner,
        address spender
    )
        public view virtual override returns (uint256)
    {
        return 0;
    }

    function approve(address spender, uint256 amount) public virtual override returns (bool) {
        return false;
    }

    function transferFrom(
        address sender,
        address recipient,
        uint256 amount
    )
        public virtual override returns (bool)
    {
        return false;
    }

    function amountOf(address account) public view returns (uint256) {
        return _locks[account].amount;
    }

    function endOf(address account) public view returns (uint256) {
        return _locks[account].end;
    }

    function startOf(address account) public view returns (uint256) {
        return _locks[account].start;
    }

    function maxEnd() public view returns (uint256) {
        return block.timestamp + MAX_TIME;
    }

    function rewardTokensLength() public view returns (uint256) {
        return rewardTokens.length;
    }

    function balanceAt(address account, uint256 timestamp) public view returns (uint256) {
        uint256 veBal = _balances[account];
        uint256 timeElapse = timestamp - startOf(account);
        uint256 lockPeriod = endOf(account) - startOf(account);

        uint256 veBalAt = veBal - veBal.mul(timeElapse).div(lockPeriod);
        return veBalAt;
    }

    function createLock(uint256 amount, LockDays lockDays) external expectInitialized {
        _createLock(amount, lockDays, block.timestamp);
    }

    function _createLock(uint256 amount, LockDays lockDays, uint256 timestamp) internal claimReward {
        LockData storage lock = _locks[msg.sender];

        require(lock.amount == 0, "must no locked");
        require(amount != 0, "amount must be non-zero");

        wasabi.transferFrom(msg.sender, address(this), amount);
        totalLockedWASABI = totalLockedWASABI + amount;

        uint256 end = timestamp + _lockDays[lockDays];
        lock.amount = amount;
        lock.end = end;
        lock.start = timestamp;

        _updateBalance(msg.sender, (end - timestamp).mul(amount).div(MAX_TIME));

        emit LockCreate(msg.sender, lock.amount, _balances[msg.sender], lock.start, lock.end);
    }

    function addAmount(uint256 amount) external expectInitialized {
        _addAmount(amount, block.timestamp);
    }

    function _addAmount(uint256 amount, uint256 timestamp) internal claimReward {
        LockData storage lock = _locks[msg.sender];

        require(lock.amount != 0, "must locked");
        require(lock.end > timestamp, "must not expired");
        require(amount != 0, "amount must be nonzero");

        wasabi.transferFrom(msg.sender, address(this), amount);
        totalLockedWASABI = totalLockedWASABI + amount;

        lock.amount = lock.amount.add(amount);
        _updateBalance(
            msg.sender,
            _balances[msg.sender].add((lock.end - timestamp).mul(amount).div(MAX_TIME))
        );

        emit LockIncreaseAmount(msg.sender, lock.amount, _balances[msg.sender], lock.start, lock.end);
    }

    function extendLock(ExtendDays extendDays) external expectInitialized {
        _extendLock(extendDays, block.timestamp);
    }

    function _extendLock(ExtendDays extendDays, uint256 timestamp) internal claimReward {
        LockData storage lock = _locks[msg.sender];
        require(lock.amount != 0, "must locked");

        uint256 end = lock.end + _extendDays[extendDays];
        // calculate equivalent lock duration
        uint256 duration = _balances[msg.sender].mul(MAX_TIME).div(lock.amount);
        duration += (end - lock.end);
        require(duration <= MAX_TIME, "end too long");

        lock.end = end;
        _updateBalance(msg.sender, duration.mul(lock.amount).div(MAX_TIME));

        emit LockExtend(msg.sender, lock.amount, _balances[msg.sender], lock.start, lock.end);
    }

    function withdraw() external expectInitialized {
        _withdraw(block.timestamp);
    }

    function _withdraw(uint256 timestamp) internal claimReward {
        LockData storage lock = _locks[msg.sender];

        require(lock.amount != 0, "must locked");
        require(lock.end <= timestamp, "must expired");

        uint256 amount = lock.amount;
        wasabi.transfer(msg.sender, amount);
        totalLockedWASABI = totalLockedWASABI - amount;

        lock.amount = 0;
        _updateBalance(msg.sender, 0);

        emit Withdraw(msg.sender, amount);
    }

    // solium-disable-next-line no-empty-blocks
    function vestEarning() external expectInitialized claimReward {
    }

    function _updateBalance(address account, uint256 newBalance) internal {
        _totalSupply = _totalSupply.sub(_balances[account]).add(newBalance);
        _balances[account] = newBalance;
    }

     // Return block rewards over the given _from (inclusive) to _to (inclusive) block.
    function getBlockReward(uint256 _from, uint256 _to) public view returns (uint256) {
        uint256 to = _to;
        uint256 from = _from;

        if (from > to) {
            return 0;
        }

        uint256 rewardPerBlock = wasabiRewardRate;
        uint256 totalRewards = (to.sub(from)).mul(rewardPerBlock);

        return totalRewards;
    }

    function collectReward() public expectInitialized {
        if (block.number <= lastRewardBlock) {
            return;
        }

        if (_totalSupply == 0) {
            lastRewardBlock = block.number;
            return;
        }

        uint256 wasabiReward = getBlockReward(lastRewardBlock, block.number);
        wasabi.mint(address(this), wasabiReward);
        _accWasabiRewardPerBalance = _accWasabiRewardPerBalance.add(wasabiReward.mul(1e18).div(_totalSupply));
        lastRewardBlock = block.number;

        for (uint i=0; i<rewardTokens.length; i++) {
            address tokenAddress = rewardTokens[i];
            if (tokenAddress != address(0)) {
                IERC20 token = IERC20(tokenAddress);
                uint256 newReward = token.balanceOf(collector);
                if (newReward == 0) {
                    return;
                }
                token.transferFrom(collector, address(this), newReward);
                _accRewardPerBalance[tokenAddress] = _accRewardPerBalance[tokenAddress].add(newReward.mul(1e18).div(_totalSupply));
           }
        }
    }

    function pendingReward(address account, address tokenAddress) public view returns (uint256) {
        require(tokenAddress != address(0), "VotingEscrow: reward token address cannot be 0x0.");
        IERC20 token = IERC20(tokenAddress);
        uint256 pending;

        if (_balances[account] > 0) {
            uint256 newReward = token.balanceOf(collector);
            uint256 newAccRewardPerBalance = _accRewardPerBalance[tokenAddress].add(newReward.mul(1e18).div(_totalSupply));
            pending = _balances[account].mul(newAccRewardPerBalance).div(1e18).sub(_rewardDebt[account][tokenAddress]);
        }
        return pending;
    }

    function pendingWasabi(address account) public view returns (uint256) {
        uint256 pending;

        if (_balances[account] > 0) {
            uint256 accRewardPerBalance = _accWasabiRewardPerBalance;
            if (block.number > lastRewardBlock) {
                uint256 wasabiReward = getBlockReward(lastRewardBlock, block.number);
                accRewardPerBalance = _accWasabiRewardPerBalance.add(wasabiReward.mul(1e18).div(_totalSupply));
            }
            pending = _balances[account].mul(accRewardPerBalance).div(1e18).sub(_wasabiRewardDebts[account]);
        }
        return pending;
    }

    modifier claimReward() {
        collectReward();
        uint256 veBal = _balances[msg.sender];
        if (veBal > 0) {
            uint256 wasabiPending = veBal.mul(_accWasabiRewardPerBalance).div(1e18).sub(_wasabiRewardDebts[msg.sender]);
            if (wasabiPending > 0) {
                if (wasabiNeedVesting) {
                    IRewardVesting wasabiVesting = IRewardVesting(wasabiVestingAddress);
                    wasabi.approve(address(wasabiVesting), wasabiPending);
                    wasabiVesting.addEarning(msg.sender, wasabiPending);
                } else {
                    _safeWasabiTransfer(msg.sender, wasabiPending);
                }
            }
            for (uint i=0; i<rewardTokens.length; i++) {
                address tokenAddress = rewardTokens[i];
                if (tokenAddress != address(0)) {
                    IERC20 token = IERC20(tokenAddress);
                    uint256 pending = veBal.mul(_accRewardPerBalance[tokenAddress]).div(1e18).sub(_rewardDebt[msg.sender][tokenAddress]);
                    if (pending > 0) {
                        bool needVesting = rewardsNeedVesting[tokenAddress];
                        if (needVesting) {
                            address rewardVestingAddress = rewardVestingsList[tokenAddress];
                            if (rewardVestingAddress != address(0)) {
                                IRewardVesting rewardVesting = IRewardVesting(rewardVestingAddress);
                                token.approve(address(rewardVesting),pending);
                                rewardVesting.addEarning(msg.sender,pending);
                            }
                        } else {
                            token.transfer(msg.sender, pending);
                        }
                    }
                }
            }
        }
        _; // _balances[msg.sender] may changed.
        veBal = _balances[msg.sender];
        for (uint i=0; i<rewardTokens.length; i++) {
            address tokenAddress = rewardTokens[i];
            if (tokenAddress != address(0)) {
                _rewardDebt[msg.sender][tokenAddress] = veBal.mul(_accRewardPerBalance[tokenAddress]).div(1e18);
            }
        }
        _wasabiRewardDebts[msg.sender] = veBal.mul(_accWasabiRewardPerBalance).div(1e18);
    }

    function _safeWasabiTransfer(address _to, uint256 _amount) internal {
        if (_amount > 0) {
            uint256 wasabiBal = wasabi.balanceOf(address(this));
            if (_amount > wasabiBal) {
                wasabi.transfer(_to, wasabiBal);
            } else {
                wasabi.transfer(_to, _amount);
            }
        }
    }
}
