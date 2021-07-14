// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.6.12;

interface IRewardVesting  {
    function addEarning(address user, uint256 amount) external;
    function userBalances(address user) external view returns (uint256 bal);
}
