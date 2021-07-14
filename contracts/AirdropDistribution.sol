pragma solidity ^0.6.12;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "hardhat/console.sol";


contract AirdropDistribution {

    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    IERC20 public airdropToken;


    struct Airdrop {
        uint256 amount;
        uint256 distributed;
    }
    mapping(address => Airdrop) public allocation;

    /// @dev The address of the account which currently has administrative capabilities over this contract.
    address public governance;

    address public pendingGovernance;

    bool public pause;

    event AllocationAdd(address indexed user, uint256 amount);
    event AirdropClaimed(address indexed user, uint256 amount);

    event PendingGovernanceUpdated(
      address pendingGovernance
    );

    event GovernanceUpdated(
      address governance
    );


    // solium-disable-next-line
    constructor(address _governance) public {
      require(_governance != address(0), "AirdropDistribution: governance address cannot be 0x0");
      governance = _governance;
      pause = true;
    }

    /*
     * Owner methods
     */
    function initialize(IERC20 _airdropToken, address[] memory _recipient, uint256[] memory _airdropAmounts) external onlyGovernance {

        airdropToken = _airdropToken;

        require(_recipient.length == _airdropAmounts.length, "AirdropDistribution: allocation length mismatch");

        for (uint256 i = 0; i < _recipient.length; i++) {
                require(
                    _recipient[i] != address(0),
                    "Recipient cannot be 0 address."
                );

                require(
                    _airdropAmounts[i] > 0,
                    "Cannot allocate zero amount."
                );


                // Add new allocation to beneficiaryAllocations
                allocation[_recipient[i]] = Airdrop(
                    _airdropAmounts[i],
                    0
                );

                emit AllocationAdd(_recipient[i], _airdropAmounts[i]);
            }

    }

    modifier onlyGovernance() {
      require(msg.sender == governance, "AirdropDistribution: only governance");
      _;
    }

    /// @dev Sets the governance.
    ///
    /// This function can only called by the current governance.
    ///
    /// @param _pendingGovernance the new pending governance.
    function setPendingGovernance(address _pendingGovernance) external onlyGovernance {
      require(_pendingGovernance != address(0), "AirdropDistribution: pending governance address cannot be 0x0");
      pendingGovernance = _pendingGovernance;

      emit PendingGovernanceUpdated(_pendingGovernance);
    }

    function acceptGovernance() external {
      require(msg.sender == pendingGovernance, "AirdropDistribution: only pending governance");

      address _pendingGovernance = pendingGovernance;
      governance = _pendingGovernance;

      emit GovernanceUpdated(_pendingGovernance);
    }

    function setPause(bool _pause) external onlyGovernance {
      pause = _pause;
    }

    function emergencyWithdraw(address transferTo) external onlyGovernance {
        require(pause == true,"AirdropDistribution: Not paused");
        airdropToken.safeTransfer(transferTo, airdropToken.balanceOf(address(this)));

    }


    function getInitialAirdropAmount(address userAddress) external view returns (uint256 initialRewardAmount) {
        uint256 initAirdropAmount = allocation[userAddress].amount;
        return initAirdropAmount;
    }

    function getDistributedAmount(address userAddress) public view returns (uint256 distributedAmount) {
        uint256 distributedAmt = allocation[userAddress].distributed;
        return distributedAmt;
    }


    function getAvailableAmount(address userAddress) public view returns (uint256 amountAvailable) {
        uint256 avalible = (allocation[userAddress].amount).sub(allocation[userAddress].distributed);
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

      airdropToken.safeTransfer(userAddress, withdrawAmount);

      emit AirdropClaimed(userAddress, withdrawAmount);
    }
}
