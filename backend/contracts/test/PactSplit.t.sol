// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {PactSplit, IUSDC} from "../src/PactSplit.sol";

// The few Foundry cheatcodes these tests use, so the repo needs no forge-std library.
interface Vm {
    function prank(address) external;
    function warp(uint256) external;
    function expectRevert(bytes4) external;
    function expectRevert() external;
}

/// Just enough of USDC for the tests: 6 decimals, mint, approve, transfer and transferFrom.
contract MockUSDC is IUSDC {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract PactSplitTest {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    MockUSDC usdc;
    PactSplit split;
    bytes32 constant ID = keccak256("austin-trip");
    address host = address(0xA11CE);
    address payee = address(0xB0B);
    address friend1 = address(0xF1);
    address friend2 = address(0xF2);
    uint128 constant SHARE = 25e6; // 25 USDC
    uint64 deadline;

    function setUp() public {
        usdc = new MockUSDC();
        split = new PactSplit(usdc);
        deadline = uint64(block.timestamp + 1 days);
        usdc.mint(friend1, 100e6);
        usdc.mint(friend2, 100e6);
        usdc.mint(host, 100e6);
        vm.prank(host);
        split.createPact(ID, payee, SHARE, 2, deadline);
    }

    function approve(address who, uint256 amount) internal {
        vm.prank(who);
        usdc.approve(address(split), amount);
    }

    function pay(address who) internal {
        approve(who, SHARE);
        vm.prank(who);
        split.payShare(ID);
    }

    function test_payPullsExactlyOneShare() public {
        approve(friend1, 1_000e6);
        vm.prank(friend1);
        split.payShare(ID);
        require(usdc.balanceOf(friend1) == 75e6, "only one share left the wallet");
        require(usdc.balanceOf(address(split)) == SHARE, "contract holds the share");
    }

    function test_releasePaysPayeeWhenFull() public {
        pay(friend1);
        pay(friend2);
        vm.prank(host);
        split.release(ID);
        require(usdc.balanceOf(payee) == 50e6, "payee got the total");
        require(usdc.balanceOf(address(split)) == 0, "contract is empty");
    }

    function test_releaseNeedsEveryShare() public {
        pay(friend1);
        vm.prank(host);
        vm.expectRevert(PactSplit.NotFull.selector);
        split.release(ID);
    }

    function test_onlyHostReleases() public {
        pay(friend1);
        pay(friend2);
        vm.prank(friend1);
        vm.expectRevert(PactSplit.NotHost.selector);
        split.release(ID);
    }

    function test_payWithoutApprovalFails() public {
        vm.prank(friend1);
        vm.expectRevert();
        split.payShare(ID);
    }

    function test_cannotPayTwice() public {
        pay(friend1);
        approve(friend1, SHARE);
        vm.prank(friend1);
        vm.expectRevert(PactSplit.AlreadyPaid.selector);
        split.payShare(ID);
    }

    function test_cannotOverfill() public {
        pay(friend1);
        pay(friend2);
        approve(host, SHARE);
        vm.prank(host);
        vm.expectRevert(PactSplit.Full.selector);
        split.payShare(ID);
    }

    function test_cannotPayAfterDeadline() public {
        approve(friend1, SHARE);
        vm.warp(deadline + 1);
        vm.prank(friend1);
        vm.expectRevert(PactSplit.PastDeadline.selector);
        split.payShare(ID);
    }

    function test_hostCancelThenRefund() public {
        pay(friend1);
        vm.prank(host);
        split.cancel(ID);
        vm.prank(friend1);
        split.claimRefund(ID);
        require(usdc.balanceOf(friend1) == 100e6, "friend got share back");
        vm.prank(friend1);
        vm.expectRevert(PactSplit.NothingToRefund.selector);
        split.claimRefund(ID);
    }

    function test_strangerCancelsOnlyAfterDeadline() public {
        pay(friend1);
        vm.prank(friend2);
        vm.expectRevert(PactSplit.CannotCancel.selector);
        split.cancel(ID);
        vm.warp(deadline + 1);
        vm.prank(friend2);
        split.cancel(ID);
    }

    function test_fullPactRefundsIfHostNeverReleases() public {
        pay(friend1);
        pay(friend2);
        vm.prank(friend1);
        vm.expectRevert(PactSplit.CannotCancel.selector);
        split.cancel(ID);
        vm.warp(deadline + 1);
        vm.prank(friend1);
        split.cancel(ID);
        vm.prank(friend2);
        split.claimRefund(ID);
        require(usdc.balanceOf(friend2) == 100e6, "friend got share back");
    }

    function test_noCancelAfterRelease() public {
        pay(friend1);
        pay(friend2);
        vm.prank(host);
        split.release(ID);
        vm.prank(host);
        vm.expectRevert(PactSplit.NotOpen.selector);
        split.cancel(ID);
    }

    function test_cannotReuseId() public {
        vm.prank(friend1);
        vm.expectRevert(PactSplit.PactExists.selector);
        split.createPact(ID, payee, SHARE, 2, deadline);
    }
}
