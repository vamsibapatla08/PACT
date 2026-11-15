// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {PactSplit} from "../src/PactSplit.sol";

// The few Foundry cheatcodes this script uses, so the repo needs no forge-std library.
interface Vm {
    function startBroadcast() external;
    function stopBroadcast() external;
}

/// Deploys PactSplit from the wallet passed on the command line, so no key is ever read from a file or env var.
///   forge script script/DeployPactSplit.s.sol:DeployPactSplit --rpc-url arc_testnet --broadcast --account pact-deployer
contract DeployPactSplit {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function run() external returns (PactSplit split) {
        vm.startBroadcast();
        split = new PactSplit();
        vm.stopBroadcast();
    }
}
