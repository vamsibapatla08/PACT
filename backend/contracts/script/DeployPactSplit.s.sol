// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {PactSplit, IUSDC} from "../src/PactSplit.sol";

// The few Foundry cheatcodes this script uses, so the repo needs no forge-std library.
interface Vm {
    function startBroadcast() external;
    function stopBroadcast() external;
}

/// Deploys PactSplit on Base Sepolia from the wallet passed on the command line, so no key is ever read from a file or env var.
///   forge script script/DeployPactSplit.s.sol:DeployPactSplit --rpc-url base_sepolia --broadcast --account pact-deployer
contract DeployPactSplit {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    /// Circle's USDC on Base Sepolia.
    IUSDC constant USDC = IUSDC(0x036CbD53842c5426634e7929541eC2318f3dCF7e);

    function run() external returns (PactSplit split) {
        vm.startBroadcast();
        split = new PactSplit(USDC);
        vm.stopBroadcast();
    }
}
