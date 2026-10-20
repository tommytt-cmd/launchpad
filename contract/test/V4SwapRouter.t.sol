// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Deployers} from "@uniswap/v4-core/test/utils/Deployers.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";

import {LaunchFactory} from "../src/LaunchFactory.sol";
import {V4SwapRouter} from "../src/V4SwapRouter.sol";

contract V4SwapRouterTest is Deployers {
    LaunchFactory private factory;
    V4SwapRouter private router;
    address private creator = makeAddr("creator");
    address private trader = makeAddr("trader");
    uint24 private constant FEE = 30_000;

    function setUp() public {
        deployFreshManagerAndRouters();
        factory = new LaunchFactory(manager, address(this));
        router = new V4SwapRouter(manager);
        vm.deal(creator, 10 ether);
        vm.deal(trader, 10 ether);
    }

    function _launch() private returns (address token) {
        vm.prank(creator);
        token = factory.launch{value: 1.0004 ether}(
            LaunchFactory.LaunchParams("Router Test", "ROUTER", "", 10 ether, FEE, address(0))
        );
    }

    function _key(address token) private pure returns (PoolKey memory) {
        return PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(token),
            fee: FEE,
            tickSpacing: 200,
            hooks: IHooks(address(0))
        });
    }

    function test_buyAndSellThroughRouter() public {
        address token = _launch();
        PoolKey memory key = _key(token);

        vm.prank(trader);
        router.swapExactInputSingle{value: 1 ether}(
            key,
            SwapParams(true, -int256(1 ether), TickMath.MIN_SQRT_PRICE + 1),
            "",
            1,
            trader
        );

        uint256 tokenBalance = IERC20(token).balanceOf(trader);
        assertGt(tokenBalance, 0);
        assertEq(address(router).balance, 0);

        vm.startPrank(trader);
        IERC20(token).approve(address(router), tokenBalance / 2);
        uint256 ethBefore = trader.balance;
        router.swapExactInputSingle(
            key,
            SwapParams(false, -int256(tokenBalance / 2), TickMath.MAX_SQRT_PRICE - 1),
            "",
            1,
            trader
        );
        vm.stopPrank();

        assertGt(trader.balance, ethBefore);
        assertEq(address(router).balance, 0);
    }

    function test_exactOutputBuyRefundsUnusedETH() public {
        address token = _launch();
        PoolKey memory key = _key(token);
        uint256 tokenOut = 1 ether;
        uint256 maxEthIn = 1 ether;
        uint256 traderBalanceBefore = trader.balance;

        vm.prank(trader);
        uint256 ethIn = router.swapExactOutputSingle{value: maxEthIn}(
            key,
            SwapParams(true, int256(tokenOut), TickMath.MIN_SQRT_PRICE + 1),
            "",
            uint128(maxEthIn),
            trader
        );

        assertGt(ethIn, 0);
        assertEq(IERC20(token).balanceOf(trader), tokenOut);
        assertEq(address(router).balance, 0);
        assertEq(trader.balance, traderBalanceBefore - ethIn);
    }
}
