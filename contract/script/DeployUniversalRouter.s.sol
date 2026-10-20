// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script} from "forge-std/Script.sol";
import {RouterParameters} from "contracts/types/RouterParameters.sol";
import {DeployUniversalRouter} from "universal-router-v4/script/DeployUniversalRouter.s.sol";

contract DeployLaunchpadUniversalRouter is DeployUniversalRouter {
    address private constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;

    function setUp() public override {
        params = RouterParameters({
            permit2: PERMIT2,
            weth9: address(0),
            v2Factory: address(0),
            v3Factory: address(0),
            pairInitCodeHash: bytes32(0),
            poolInitCodeHash: bytes32(0),
            v4PoolManager: vm.envAddress("POOL_MANAGER"),
            permissionsAdapterFactory: address(0),
            v3NFTPositionManager: address(0),
            v4PositionManager: address(0),
            spokePool: address(0)
        });
    }

}