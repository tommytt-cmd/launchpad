// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {BaseHook} from "@uniswap/v4-hooks-public/src/base/BaseHook.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";

/// @notice Optional hook that caps the size of a SINGLE BUY right after launch.
///
/// Schedule (all measured from the moment the factory calls startWindow):
///   0 - 60s     : flat cap of 0.25% of supply per buy
///   60s - 300s  : cap rises linearly from 0.25% to 2.00% of supply
///   after 300s  : no cap
/// Sells are never capped.
///
/// LIMITATION: the cap is per transaction, not per wallet. A bot can split a big buy
/// into many small ones. This slows sniping; it does not prevent it.
///
/// Pool layout assumed by this hook (enforced by LaunchFactory): currency0 = native ETH,
/// currency1 = the launch token. A "buy" is therefore a swap where the swapper receives
/// a positive amount1.
contract AntiSnipeHook is BaseHook {
    using PoolIdLibrary for PoolKey;

    uint256 public constant TOTAL_SUPPLY = 1_000_000_000 ether;
    uint256 public constant FLAT_WINDOW = 60; // seconds
    uint256 public constant RISE_WINDOW = 240; // seconds
    uint256 public constant START_CAP_BPS = 25; // 0.25%
    uint256 public constant END_CAP_BPS = 200; // 2.00%

    address public immutable factory;
    mapping(PoolId => uint64) public windowStart;

    error NotFactory();
    error AlreadyStarted();
    error BuyTooLarge(uint256 bought, uint256 cap);

    constructor(IPoolManager _poolManager, address _factory) BaseHook(_poolManager) {
        factory = _factory;
    }

    function getHookPermissions() public pure override returns (Hooks.Permissions memory) {
        return Hooks.Permissions({
            beforeInitialize: false,
            afterInitialize: false,
            beforeAddLiquidity: false,
            afterAddLiquidity: false,
            beforeRemoveLiquidity: false,
            afterRemoveLiquidity: false,
            beforeSwap: false,
            afterSwap: true,
            beforeDonate: false,
            afterDonate: false,
            beforeSwapReturnDelta: false,
            afterSwapReturnDelta: false,
            afterAddLiquidityReturnDelta: false,
            afterRemoveLiquidityReturnDelta: false
        });
    }

    /// @notice Called once by the factory after the creator's initial buy, so the
    /// creator's own purchase is not subject to the cap.
    function startWindow(PoolKey calldata key) external {
        if (msg.sender != factory) revert NotFactory();
        PoolId id = key.toId();
        if (windowStart[id] != 0) revert AlreadyStarted();
        windowStart[id] = uint64(block.timestamp);
    }

    function _afterSwap(address, PoolKey calldata key, SwapParams calldata, BalanceDelta delta, bytes calldata)
        internal
        view
        override
        returns (bytes4, int128)
    {
        uint64 start = windowStart[key.toId()];
        if (start == 0) return (BaseHook.afterSwap.selector, 0);

        uint256 elapsed = block.timestamp - start;
        if (elapsed >= FLAT_WINDOW + RISE_WINDOW) return (BaseHook.afterSwap.selector, 0);

        // delta is from the swapper's perspective: positive amount1 = tokens received = a buy.
        int128 received = delta.amount1();
        if (received > 0) {
            uint256 capBps = elapsed < FLAT_WINDOW
                ? START_CAP_BPS
                : START_CAP_BPS + ((END_CAP_BPS - START_CAP_BPS) * (elapsed - FLAT_WINDOW)) / RISE_WINDOW;
            uint256 cap = (TOTAL_SUPPLY * capBps) / 10_000;
            if (uint256(uint128(received)) > cap) revert BuyTooLarge(uint256(uint128(received)), cap);
        }
        return (BaseHook.afterSwap.selector, 0);
    }
}
