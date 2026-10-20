// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {V4Quoter} from "@uniswap/v4-periphery/src/lens/V4Quoter.sol";

contract DeployLaunchpadV4Quoter is Script {
    function run() external {
        IPoolManager poolManager = IPoolManager(vm.envAddress("POOL_MANAGER"));

        vm.startBroadcast();
        V4Quoter quoter = new V4Quoter(poolManager);
        vm.stopBroadcast();

        console2.log("V4Quoter:", address(quoter));
        console2.log("PoolManager:", address(quoter.poolManager()));
    }
}
