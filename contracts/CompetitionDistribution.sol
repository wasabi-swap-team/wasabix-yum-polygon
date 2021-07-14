// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.6.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "hardhat/console.sol";


contract CompetitionDistribution {

    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    IERC20 public wasabi;

    // Variable for earning with locks
    struct RewardBalance {
        uint256 rewardAmount;
        uint256 distributed;
    }
    mapping(address => RewardBalance) public allocation;

    // Duration of vesting penalty period

    // vesting start time unix
    uint256 private _start;


    uint256 private constant SECONDS_PER_DAY = 24 * 60 * 60;                 /* 86400 seconds in a day */
    uint256 public duration = 30; // in day number
    uint256 public vesting = 12; // in month mumber

    /// @dev The address of the account which currently has administrative capabilities over this contract.
    address public governance;

    address public pendingGovernance;

    bool public pause;

    event AllocationAdd(address indexed user, uint256 amount);
    event RewardWithdraw(address indexed user, uint256 amount);

    event PendingGovernanceUpdated(
      address pendingGovernance
    );

    event GovernanceUpdated(
      address governance
    );


    // solium-disable-next-line
    constructor(address _governance, uint256 _startTimestamp) public {
      require(_governance != address(0), "CompetitionDistribution: governance address cannot be 0x0");
      governance = _governance;
      pause = true;
      _start = _startTimestamp;
    }

    /*
     * Owner methods
     */
    function initialize(IERC20 _wasabi, address[] memory _recipient, uint256[] memory _rewardAmounts) external onlyGovernance {

        wasabi = _wasabi;

        require(_recipient.length == _rewardAmounts.length, "CompetitionDistribution: allocation length mismatch");

        for (uint256 i = 0; i < _recipient.length; i++) {
                require(
                    _recipient[i] != address(0),
                    "Recipient cannot be 0 address."
                );

                require(
                    _rewardAmounts[i] > 0,
                    "Cannot allocate zero amount."
                );


                // Add new allocation to beneficiaryAllocations
                allocation[_recipient[i]] = RewardBalance(
                    _rewardAmounts[i],
                    0
                );

                emit AllocationAdd(_recipient[i], _rewardAmounts[i]);
            }

    }

    modifier onlyGovernance() {
      require(msg.sender == governance, "CompetitionDistribution: only governance");
      _;
    }

    /// @dev Sets the governance.
    ///
    /// This function can only called by the current governance.
    ///
    /// @param _pendingGovernance the new pending governance.
    function setPendingGovernance(address _pendingGovernance) external onlyGovernance {
      require(_pendingGovernance != address(0), "CompetitionDistribution: pending governance address cannot be 0x0");
      pendingGovernance = _pendingGovernance;

      emit PendingGovernanceUpdated(_pendingGovernance);
    }

    function acceptGovernance() external {
      require(msg.sender == pendingGovernance, "CompetitionDistribution: only pending governance");

      address _pendingGovernance = pendingGovernance;
      governance = _pendingGovernance;

      emit GovernanceUpdated(_pendingGovernance);
    }

    function setPause(bool _pause) external onlyGovernance {
      pause = _pause;
    }

    function emergencyWithdraw(address transferTo) external onlyGovernance {
        require(pause == true,"CompetitionDistribution: Not paused");
        wasabi.safeTransfer(transferTo, wasabi.balanceOf(address(this)));

    }

    /**
     * @return the start time of the token vesting. in unix
     */
    function start() public view returns(uint256) {
      return _start;
    }

    function today() virtual public view returns (uint256 dayNumber) {
        return uint256(block.timestamp / SECONDS_PER_DAY);
    }

    function startDay() public view returns (uint256 dayNumber) {
        return uint256(_start / SECONDS_PER_DAY);
    }

    function getInitialRewardAmount(address userAddress) external view returns (uint256 initialRewardAmount) {
        uint256 initRewardAmount = allocation[userAddress].rewardAmount;
        return initRewardAmount;
    }

    function getDistributedAmount(address userAddress) public view returns (uint256 distributedAmount) {
        uint256 distributedAmt = allocation[userAddress].distributed;
        return distributedAmt;
    }

    function getVestedAmount(address userAddress) public view returns (uint256 amountVested) {

        // If after end of vesting, then the vested amount is total amount.
        if (today() >= (startDay() + duration * vesting)) {
          return allocation[userAddress].rewardAmount;
        }
        // If it's before the vesting then the vested amount is zero.
        else if (today() <= startDay())
        {
            // All are vested (none are not vested)
            return uint256(0);
        }
        // Otherwise a fractional amount is vested.
        else
        {
            // Compute the exact number of days vested.
            uint256 daysVested = today() - startDay();
            // Adjust result rounding down to take into consideration the interval.
            uint256 effectiveDaysVested = (daysVested / duration) * duration;

            uint256 vested = allocation[userAddress].rewardAmount.mul(effectiveDaysVested).div(vesting*duration);
            return vested;
        }
    }


    function getAvailableAmount(address userAddress) public view returns (uint256 amountAvailable) {
        uint256 avalible = getVestedAmount(userAddress).sub(allocation[userAddress].distributed);
        return avalible;
    }



    function withdraw(uint256 withdrawAmount) public {

      address userAddress = msg.sender;

      require(
          pause == false,
          "Withdraw paused"
      );


      require(getAvailableAmount(userAddress) >= withdrawAmount,"insufficient avalible balance");

      allocation[userAddress].distributed = allocation[userAddress].distributed.add(withdrawAmount);

      wasabi.safeTransfer(userAddress, withdrawAmount);

      emit RewardWithdraw(userAddress, withdrawAmount);
    }
}
