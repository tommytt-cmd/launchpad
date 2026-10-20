// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Deployers} from "@uniswap/v4-core/test/utils/Deployers.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {LaunchFactory} from "../src/LaunchFactory.sol";

contract LaunchTest is Deployers {
    LaunchFactory factory;
    address creator = makeAddr("creator");
    address trader = makeAddr("trader");

    uint256 constant S = 1_000_000_000 ether;
    uint24 constant FEE = 30_000; // 3%

    function setUp() public {
        deployFreshManagerAndRouters(); // gives `manager` and `swapRouter`
        factory = new LaunchFactory(manager, address(this));
        vm.deal(creator, 10 ether);
        vm.deal(trader, 100 ether);
    }

    // ------------------------------------------------------------ helpers
    function _launch(address hook) internal returns (address token) {
        vm.prank(creator);
        token = factory.launch{value: 1.0004 ether}( // 0.0004 fee + 1 ETH buy budget
            LaunchFactory.LaunchParams({
                name: "Doge",
                symbol: "DOGE",
                metadataURI: "ipfs://meta",
                fdv: 10 ether,
                fee: FEE,
                hook: hook
            })
        );
    }

    function _key(address token, address hook) internal pure returns (PoolKey memory) {
        return PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(token),
            fee: FEE,
            tickSpacing: 200,
            hooks: IHooks(hook)
        });
    }

    function _buyParams(uint256 ethIn) internal pure returns (SwapParams memory) {
        return SwapParams({
            zeroForOne: true, amountSpecified: -int256(ethIn), sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
        });
    }

    function _sellParams(uint256 tokensIn) internal pure returns (SwapParams memory) {
        return SwapParams({
            zeroForOne: false, amountSpecified: -int256(tokensIn), sqrtPriceLimitX96: TickMath.MAX_SQRT_PRICE - 1
        });
    }

    PoolSwapTest.TestSettings internal settings = PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false});

    // ------------------------------------------------------------ tests
    function test_launch_mintsFixedSupplyAndLocksIt() public {
        address token = _launch(address(0));

        assertEq(IERC20(token).totalSupply(), S);
        // creator bought ~1 ETH worth at ~10 ETH FDV, after the 3% fee: about 8.8% of supply
        uint256 bal = IERC20(token).balanceOf(creator);
        assertApproxEqRel(bal, (S * 97) / 1097, 0.05e18);
        assertLe(bal, S / 10);
        // nothing left sitting in the factory
        assertEq(IERC20(token).balanceOf(address(factory)), 0);
    }

    function test_revert_badFee() public {
        vm.prank(creator);
        vm.expectRevert(LaunchFactory.BadFee.selector);
        factory.launch{value: 1 ether}(
            LaunchFactory.LaunchParams("X", "X", "", 10 ether, 5_000, address(0)) // 0.5% < 1% minimum
        );
    }

    function test_harvest_splits70_30_and_claim_paysCreator() public {
        address token = _launch(address(0));
        PoolKey memory key = _key(token, address(0));

        vm.prank(trader);
        swapRouter.swap{value: 1 ether}(key, _buyParams(1 ether), settings, "");

        factory.harvest(token);

        // total ETH-side fees ~ 3% of (1 ETH initial buy + 1 ETH trader buy) = 0.06 ETH; creator gets 70%
        assertApproxEqRel(factory.creatorEth(token), 0.042 ether, 0.02e18);

        uint256 before = creator.balance;
        factory.claim(token);
        assertGt(creator.balance, before);
        assertEq(factory.creatorEth(token), 0);
    }

    function test_sellSideFeesAreCreditedInTokens() public {
        address token = _launch(address(0));
        PoolKey memory key = _key(token, address(0));

        vm.startPrank(trader);
        swapRouter.swap{value: 2 ether}(key, _buyParams(2 ether), settings, "");
        uint256 tokens = IERC20(token).balanceOf(trader);
        IERC20(token).approve(address(swapRouter), type(uint256).max);
        swapRouter.swap(key, _sellParams(tokens / 2), settings, "");
        vm.stopPrank();

        factory.harvest(token);
        assertGt(factory.creatorToken(token), 0);
    }

    function test_holdToEarn_blocksClaimWhileBelowSnapshot() public {
        address token = _launch(address(0));
        PoolKey memory key = _key(token, address(0));

        vm.prank(trader);
        swapRouter.swap{value: 1 ether}(key, _buyParams(1 ether), settings, "");
        factory.harvest(token);

        uint256 bal = IERC20(token).balanceOf(creator);
        vm.prank(creator);
        IERC20(token).transfer(trader, bal); // creator dumps everything

        vm.expectRevert(LaunchFactory.HoldGate.selector);
        factory.claim(token);

        vm.prank(trader);
        IERC20(token).transfer(creator, bal); // creator restores balance
        factory.claim(token); // now succeeds
    }

    function test_antiSnipe_capsBuysThenReleases() public {
        // etch the hook at an address whose low bits equal the afterSwap flag
        address hookAddr = address(uint160(Hooks.AFTER_SWAP_FLAG) ^ (uint160(0x4444) << 144));
        deployCodeTo("AntiSnipeHook.sol:AntiSnipeHook", abi.encode(manager, address(factory)), hookAddr);
        factory.setHookApproved(hookAddr, true);

        address token = _launch(hookAddr);
        PoolKey memory key = _key(token, hookAddr);

        // small buy (~0.1% of supply) is fine
        vm.prank(trader);
        swapRouter.swap{value: 0.01 ether}(key, _buyParams(0.01 ether), settings, "");

        // big buy (~15% of supply) reverts inside the window
        vm.prank(trader);
        vm.expectRevert();
        swapRouter.swap{value: 2 ether}(key, _buyParams(2 ether), settings, "");

        // after the 300s window, the same buy goes through
        vm.warp(block.timestamp + 301);
        vm.prank(trader);
        swapRouter.swap{value: 2 ether}(key, _buyParams(2 ether), settings, "");
    }

}
