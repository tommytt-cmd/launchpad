// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {SafeCast} from "@uniswap/v4-core/src/libraries/SafeCast.sol";
import {SafeTransferLib} from "solmate/src/utils/SafeTransferLib.sol";
import {ERC20} from "solmate/src/tokens/ERC20.sol";
import {SafeCallback} from "@uniswap/v4-periphery/src/base/SafeCallback.sol";
import {DeltaResolver} from "@uniswap/v4-periphery/src/base/DeltaResolver.sol";
import {ReentrancyLock} from "@uniswap/v4-periphery/src/base/ReentrancyLock.sol";

/// @title V4SwapRouter
/// @notice Minimal live V4 router for exact-input and exact-output swaps against a PoolManager.
contract V4SwapRouter is SafeCallback, DeltaResolver, ReentrancyLock {
    using SafeTransferLib for *;

    error InvalidExactInput();
    error InvalidExactOutput();
    error InsufficientNativeValue();
    error AmountOutTooSmall(uint256 minimum, uint256 actual);
    error AmountInTooLarge(uint256 maximum, uint256 actual);
    error NoSwapOccurred();

    struct CallbackData {
        address sender;
        PoolKey key;
        SwapParams params;
        bytes hookData;
        address recipient;
        uint128 amountBound;
    }

    constructor(IPoolManager _poolManager) SafeCallback(_poolManager) {}

    function swapExactInputSingle(
        PoolKey calldata key,
        SwapParams calldata params,
        bytes calldata hookData,
        uint128 amountOutMinimum,
        address recipient
    ) external payable isNotLocked returns (uint256 amountOut) {
        if (params.amountSpecified >= 0 || params.amountSpecified == type(int256).min) revert InvalidExactInput();

        uint128 amountIn = uint128(uint256(-params.amountSpecified));
        Currency inputCurrency = params.zeroForOne ? key.currency0 : key.currency1;
        if (inputCurrency.isAddressZero() && msg.value < amountIn) revert InsufficientNativeValue();

        BalanceDelta delta = abi.decode(
            poolManager.unlock(
                abi.encode(CallbackData(msg.sender, key, params, hookData, recipient, amountOutMinimum))
            ),
            (BalanceDelta)
        );

        int128 outDelta = params.zeroForOne ? delta.amount1() : delta.amount0();
        if (outDelta < 0) revert NoSwapOccurred();
        amountOut = uint128(uint256(int256(outDelta)));
        if (amountOut < amountOutMinimum) revert AmountOutTooSmall(amountOutMinimum, amountOut);
        _refundExcessETH(msg.sender, inputCurrency.isAddressZero() ? msg.value - amountIn : msg.value);
        return amountOut;
    }

    function swapExactOutputSingle(
        PoolKey calldata key,
        SwapParams calldata params,
        bytes calldata hookData,
        uint128 amountInMaximum,
        address recipient
    ) external payable isNotLocked returns (uint256 amountIn) {
        if (params.amountSpecified <= 0 || uint256(params.amountSpecified) > type(uint128).max) {
            revert InvalidExactOutput();
        }

        Currency inputCurrency = params.zeroForOne ? key.currency0 : key.currency1;
        if (inputCurrency.isAddressZero() && msg.value < amountInMaximum) revert InsufficientNativeValue();

        BalanceDelta delta = abi.decode(
            poolManager.unlock(
                abi.encode(CallbackData(msg.sender, key, params, hookData, recipient, amountInMaximum))
            ),
            (BalanceDelta)
        );

        int128 inDelta = params.zeroForOne ? delta.amount0() : delta.amount1();
        if (inDelta >= 0) revert NoSwapOccurred();
        amountIn = uint128(uint256(-int256(inDelta)));
        _refundExcessETH(msg.sender, inputCurrency.isAddressZero() ? msg.value - amountIn : msg.value);
        return amountIn;
    }

    function _unlockCallback(bytes calldata rawData) internal override returns (bytes memory) {
        CallbackData memory data = abi.decode(rawData, (CallbackData));

        Currency inputCurrency = data.params.zeroForOne ? data.key.currency0 : data.key.currency1;
        Currency outputCurrency = data.params.zeroForOne ? data.key.currency1 : data.key.currency0;

        if (data.params.amountSpecified < 0) {
            uint128 amountIn = uint128(uint256(-data.params.amountSpecified));
            _settle(inputCurrency, data.sender, amountIn);
            uint256 settledIn = _getFullCredit(inputCurrency);
            BalanceDelta exactInputDelta = poolManager.swap(
                data.key,
                SwapParams(data.params.zeroForOne, -int256(settledIn), data.params.sqrtPriceLimitX96),
                data.hookData
            );
            uint256 exactInputOutputAmount = _getFullCredit(outputCurrency);
            if (exactInputOutputAmount < data.amountBound) {
                revert AmountOutTooSmall(data.amountBound, exactInputOutputAmount);
            }
            _take(outputCurrency, data.recipient, exactInputOutputAmount);
            return abi.encode(exactInputDelta);
        }

        uint128 amountOut = uint128(uint256(data.params.amountSpecified));
        BalanceDelta exactOutputDelta = poolManager.swap(
            data.key,
            SwapParams(data.params.zeroForOne, int256(uint256(amountOut)), data.params.sqrtPriceLimitX96),
            data.hookData
        );
        int128 exactOutputDeltaOut = data.params.zeroForOne ? exactOutputDelta.amount1() : exactOutputDelta.amount0();
        if (exactOutputDeltaOut < 0 || uint256(int256(exactOutputDeltaOut)) < amountOut) {
            revert AmountOutTooSmall(amountOut, exactOutputDeltaOut > 0 ? uint256(int256(exactOutputDeltaOut)) : 0);
        }
        uint256 amountInNeeded = paramsInput(exactOutputDelta, data.params.zeroForOne);
        if (amountInNeeded > data.amountBound) revert AmountInTooLarge(data.amountBound, amountInNeeded);
        _settle(inputCurrency, data.sender, amountInNeeded);
        _take(outputCurrency, data.recipient, _getFullCredit(outputCurrency));
        return abi.encode(exactOutputDelta);
    }

    function _pay(Currency token, address payer, uint256 amount) internal override {
        if (payer == address(this)) {
            token.transfer(address(poolManager), amount);
            return;
        }
        ERC20(Currency.unwrap(token)).safeTransferFrom(payer, address(poolManager), amount);
    }

    function paramsInput(BalanceDelta delta, bool zeroForOne) internal pure returns (uint256) {
        int128 inDelta = zeroForOne ? delta.amount0() : delta.amount1();
        if (inDelta >= 0) revert NoSwapOccurred();
        return uint256(-int256(inDelta));
    }

    function _refundExcessETH(address recipient, uint256 amount) private {
        if (amount > 0) recipient.safeTransferETH(amount);
    }

    receive() external payable {}
}
