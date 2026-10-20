// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "forge-std/interfaces/IERC20.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IV4Router} from "@uniswap/v4-periphery/src/interfaces/IV4Router.sol";
import {UniversalRouter} from "contracts/UniversalRouter.sol";

contract SellUniversalRouter is Script {
    address private constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;

    function run() external {
        address routerAddress = vm.envAddress("V4_ROUTER");
        address token = vm.envAddress("TOKEN");
        address recipient = vm.envAddress("SENDER");
        uint256 amountIn = vm.envUint("SWAP_AMOUNT");
        uint256 minAmountOut = vm.envUint("MIN_ETH_OUT");
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
            zeroForOne: false,
            amountIn: uint128(amountIn),
            amountOutMinimum: uint128(minAmountOut),
            minHopPriceX36: 0,
            hookData: bytes("")
        });

        bytes memory actions = hex"060c0e";
        bytes[] memory actionParams = new bytes[](3);
        actionParams[0] = abi.encode(swapParams);
        actionParams[1] = abi.encode(Currency.wrap(token), amountIn);
        actionParams[2] = abi.encode(Currency.wrap(address(0)), recipient, 0);

        bytes memory commands = hex"10";
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(actions, actionParams);

        vm.startBroadcast();
        IERC20(token).approve(PERMIT2, type(uint256).max);
        IAllowanceTransfer(PERMIT2).approve(token, routerAddress, uint160(amountIn), uint48(block.timestamp + 1 days));
        UniversalRouter(payable(routerAddress)).execute(commands, inputs);
        vm.stopBroadcast();

        console2.log("Token:", token);
        console2.log("Token sold:", amountIn);
        console2.log("Minimum ETH output:", minAmountOut);
    }
}
