// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.6.12;

interface IVotingEscrow  {
    function balanceOf(address account) external view returns (uint256);
    function totalSupply() external view returns (uint256);
}
