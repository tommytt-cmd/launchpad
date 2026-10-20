// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "forge-std/interfaces/IERC20.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IV4Router} from "@uniswap/v4-periphery/src/interfaces/IV4Router.sol";
import {UniversalRouter} from "contracts/UniversalRouter.sol";

contract SwapUniversalRouter is Script {
    function run() external {
        address routerAddress = vm.envAddress("V4_ROUTER");
        address token = vm.envAddress("TOKEN");
        uint256 amountIn = vm.envUint("SWAP_AMOUNT");
        uint256 minAmountOut = vm.envUint("MIN_TOKEN_OUT");
        address sender = vm.envAddress("SENDER");
        require(amountIn <= type(uint128).max && minAmountOut <= type(uint128).max, "amount exceeds uint128");

        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(token),
            fee: 30_000,
            tickSpacing: 200,
            hooks: IHooks(address(0))
        });
        IV4Router.ExactInputSingleParams memory swapParams = IV4Router.ExactInputSingleParams({
            poolKey: key,
            zeroForOne: true,
            amountIn: uint128(amountIn),
            amountOutMinimum: uint128(minAmountOut),
            minHopPriceX36: 0,
            hookData: bytes("")
        });

        bytes memory actions = hex"060c0f";
        bytes[] memory actionParams = new bytes[](3);
        actionParams[0] = abi.encode(swapParams);
        actionParams[1] = abi.encode(Currency.wrap(address(0)), amountIn);
        actionParams[2] = abi.encode(Currency.wrap(token), minAmountOut);

        bytes memory commands = hex"10";
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(actions, actionParams);

        vm.startBroadcast();
        uint256 beforeBalance = IERC20(token).balanceOf(sender);
        UniversalRouter(payable(routerAddress)).execute{value: amountIn}(commands, inputs);
        uint256 afterBalance = IERC20(token).balanceOf(sender);
        vm.stopBroadcast();

        console2.log("Token:", token);
        console2.log("Amount in:", amountIn);
        console2.log("Token output:", afterBalance - beforeBalance);
    }
}
