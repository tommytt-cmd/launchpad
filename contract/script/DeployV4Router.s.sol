// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {V4SwapRouter} from "../src/V4SwapRouter.sol";

/// forge script script/DeployV4Router.s.sol --rpc-url $RPC --account rh-testnet --broadcast
contract DeployV4Router is Script {
    function run() external {
        IPoolManager poolManager = IPoolManager(vm.envAddress("POOL_MANAGER"));

        vm.startBroadcast();
        V4SwapRouter router = new V4SwapRouter(poolManager);
        vm.stopBroadcast();

        console.log("V4SwapRouter:", address(router));
    }
}
