// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// Holds each member's share of a pact's cost until the host releases it to the payee, or refunds everyone.
/// Shares are paid in native USDC on Arc (msg.value, 18 decimals), so paying is one call with no approve step.
/// One contract serves every pact. A pact is keyed by its Supabase pact id as bytes32.
contract PactSplit {
    enum State {
        None,
        Open,
        Released,
        Cancelled
    }

    struct Pact {
        address host;
        address payee;
        uint128 share;
        uint32 sharesNeeded;
        uint32 sharesPaid;
        uint64 deadline;
        State state;
    }

    mapping(bytes32 => Pact) public pacts;
    mapping(bytes32 => mapping(address => bool)) public paid;

    event PactCreated(
        bytes32 indexed pactId, address indexed host, address payee, uint256 share, uint32 sharesNeeded, uint64 deadline
    );
    event SharePaid(bytes32 indexed pactId, address indexed payer, uint256 amount);
    event Released(bytes32 indexed pactId, address indexed payee, uint256 amount);
    event Cancelled(bytes32 indexed pactId);
    event Refunded(bytes32 indexed pactId, address indexed payer, uint256 amount);

    error PactExists();
    error BadPact();
    error NotOpen();
    error NotHost();
    error WrongAmount();
    error AlreadyPaid();
    error Full();
    error PastDeadline();
    error NotFull();
    error CannotCancel();
    error NothingToRefund();
    error TransferFailed();

    function createPact(bytes32 pactId, address payee, uint128 share, uint32 sharesNeeded, uint64 deadline) external {
        if (pacts[pactId].state != State.None) revert PactExists();
        if (payee == address(0) || share == 0 || sharesNeeded == 0 || deadline <= block.timestamp) revert BadPact();
        pacts[pactId] = Pact(msg.sender, payee, share, sharesNeeded, 0, deadline, State.Open);
        emit PactCreated(pactId, msg.sender, payee, share, sharesNeeded, deadline);
    }

    function payShare(bytes32 pactId) external payable {
        Pact storage p = pacts[pactId];
        if (p.state != State.Open) revert NotOpen();
        if (block.timestamp > p.deadline) revert PastDeadline();
        if (msg.value != p.share) revert WrongAmount();
        if (paid[pactId][msg.sender]) revert AlreadyPaid();
        if (p.sharesPaid == p.sharesNeeded) revert Full();
        paid[pactId][msg.sender] = true;
        p.sharesPaid++;
        emit SharePaid(pactId, msg.sender, msg.value);
    }

    /// The host sends the full amount to the payee once every share is in.
    function release(bytes32 pactId) external {
        Pact storage p = pacts[pactId];
        if (p.state != State.Open) revert NotOpen();
        if (msg.sender != p.host) revert NotHost();
        if (p.sharesPaid != p.sharesNeeded) revert NotFull();
        p.state = State.Released;
        uint256 total = uint256(p.share) * p.sharesNeeded;
        _send(p.payee, total);
        emit Released(pactId, p.payee, total);
    }

    /// The host can cancel any time before release. Anyone can cancel after the deadline, so shares are never
    /// stuck if the host disappears. The host must release before the deadline.
    function cancel(bytes32 pactId) external {
        Pact storage p = pacts[pactId];
        if (p.state != State.Open) revert NotOpen();
        if (msg.sender != p.host && block.timestamp <= p.deadline) revert CannotCancel();
        p.state = State.Cancelled;
        emit Cancelled(pactId);
    }

    /// After a cancel, each payer pulls their own share back.
    function claimRefund(bytes32 pactId) external {
        Pact storage p = pacts[pactId];
        if (p.state != State.Cancelled) revert NotOpen();
        if (!paid[pactId][msg.sender]) revert NothingToRefund();
        paid[pactId][msg.sender] = false;
        _send(msg.sender, p.share);
        emit Refunded(pactId, msg.sender, p.share);
    }

    function _send(address to, uint256 amount) private {
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
}
