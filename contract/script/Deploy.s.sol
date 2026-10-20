// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {HookMiner} from "@uniswap/v4-periphery/test/shared/HookMiner.sol";

import {LaunchFactory} from "../src/LaunchFactory.sol";
import {AntiSnipeHook} from "../src/AntiSnipeHook.sol";

/// forge script script/Deploy.s.sol --rpc-url $RPC --private-key $PK --broadcast
/// Env: POOL_MANAGER (official Uniswap V4 PoolManager on the target chain), OWNER (platform admin)
contract Deploy is Script {
    // Standard deterministic CREATE2 deployer. VERIFY it exists on your target chain before relying on it.
    address constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;

    function run() external {
        IPoolManager pm = IPoolManager(vm.envAddress("POOL_MANAGER"));
        address owner = vm.envAddress("OWNER");

        vm.startBroadcast();

        LaunchFactory factory = new LaunchFactory(pm, owner);

        // V4 reads a hook's permissions from the low bits of its ADDRESS, so we mine a salt
        // that produces an address whose bits equal exactly the afterSwap flag.
        uint160 flags = uint160(Hooks.AFTER_SWAP_FLAG);
        bytes memory args = abi.encode(pm, address(factory));
        (address expected, bytes32 salt) =
            HookMiner.find(CREATE2_DEPLOYER, flags, type(AntiSnipeHook).creationCode, args);

        AntiSnipeHook hook = new AntiSnipeHook{salt: salt}(pm, address(factory));
        require(address(hook) == expected, "hook address mismatch");

        vm.stopBroadcast();

        console.log("Factory:", address(factory));
        console.log("AntiSnipeHook:", address(hook));
        console.log("Next: owner must call factory.setHookApproved(hook, true)");
    }
}
