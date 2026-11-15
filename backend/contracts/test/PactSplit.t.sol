// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {PactSplit} from "../src/PactSplit.sol";

// The few Foundry cheatcodes these tests use, so the repo needs no forge-std library.
interface Vm {
    function prank(address) external;
    function deal(address, uint256) external;
    function warp(uint256) external;
    function expectRevert(bytes4) external;
}

contract PactSplitTest {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    PactSplit split;
    bytes32 constant ID = keccak256("austin-trip");
    address host = address(0xA11CE);
    address payee = address(0xB0B);
    address friend1 = address(0xF1);
    address friend2 = address(0xF2);
    uint128 constant SHARE = 25e18; // 25 USDC
    uint64 deadline;

    function setUp() public {
        split = new PactSplit();
        deadline = uint64(block.timestamp + 1 days);
        vm.deal(host, 100e18);
        vm.deal(friend1, 100e18);
        vm.deal(friend2, 100e18);
        vm.prank(host);
        split.createPact(ID, payee, SHARE, 2, deadline);
    }

    function pay(address who) internal {
        vm.prank(who);
        split.payShare{value: SHARE}(ID);
    }

    function test_releasePaysPayeeWhenFull() public {
        pay(friend1);
        pay(friend2);
        vm.prank(host);
        split.release(ID);
        require(payee.balance == 50e18, "payee got the total");
        require(address(split).balance == 0, "contract is empty");
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

    function test_wrongAmountRejected() public {
        vm.prank(friend1);
        vm.expectRevert(PactSplit.WrongAmount.selector);
        split.payShare{value: SHARE - 1}(ID);
    }

    function test_cannotPayTwice() public {
        pay(friend1);
        vm.prank(friend1);
        vm.expectRevert(PactSplit.AlreadyPaid.selector);
        split.payShare{value: SHARE}(ID);
    }

    function test_cannotOverfill() public {
        pay(friend1);
        pay(friend2);
        vm.prank(host);
        vm.expectRevert(PactSplit.Full.selector);
        split.payShare{value: SHARE}(ID);
    }

    function test_cannotPayAfterDeadline() public {
        vm.warp(deadline + 1);
        vm.prank(friend1);
        vm.expectRevert(PactSplit.PastDeadline.selector);
        split.payShare{value: SHARE}(ID);
    }

    function test_hostCancelThenRefund() public {
        pay(friend1);
        vm.prank(host);
        split.cancel(ID);
        vm.prank(friend1);
        split.claimRefund(ID);
        require(friend1.balance == 100e18, "friend got share back");
        vm.prank(friend1);
        vm.expectRevert(PactSplit.NothingToRefund.selector);
        split.claimRefund(ID);
    }

    function test_strangerCancelsOnlyWhenExpiredShort() public {
        pay(friend1);
        vm.prank(friend2);
        vm.expectRevert(PactSplit.CannotCancel.selector);
        split.cancel(ID);
        vm.warp(deadline + 1);
        vm.prank(friend2);
        split.cancel(ID);
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
