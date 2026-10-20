// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {SwapParams, ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {LiquidityAmounts} from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {LaunchToken} from "./LaunchToken.sol";

interface IWindowedHook {
    function startWindow(PoolKey calldata key) external;
}

/// @title LaunchFactory
/// @notice One transaction: deploy a fixed-supply token, open a Uniswap V4 pool (native ETH / token),
/// lock the whole supply as single-sided liquidity, and make the creator's initial buy.
///
/// LIQUIDITY LOCK: this contract owns the liquidity position and contains NO code path that removes
/// liquidity. The only modifyLiquidity calls are (a) the initial add and (b) liquidityDelta == 0 fee
/// collection. Keep it that way. Any upgrade/admin function that could call modifyLiquidity with a
/// negative delta would break the lock guarantee.
///
/// FEES: the pool's LP fee (creator-chosen 1%-5%) accrues to the locked position. harvest() sweeps it
/// and credits 70% to the creator, 30% to the platform. Creator claims are gated by hold-to-earn.
///
/// UNAUDITED MVP. See README for known limitations.
contract LaunchFactory is IUnlockCallback, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------- constants
    uint256 public constant SUPPLY = 1_000_000_000 ether;
    uint24 public constant MIN_FEE = 10_000; // 1%  (V4 fees are in hundredths of a bip)
    uint24 public constant MAX_FEE = 50_000; // 5%
    int24 public constant TICK_SPACING = 200;
    uint256 public constant CREATOR_SHARE_BPS = 7_000; // 70% of fees to creator
    uint256 public constant MAX_CREATOR_ALLOC_BPS = 1_000; // creator may buy at most 10% at launch
    address private constant DEAD = 0x000000000000000000000000000000000000dEaD;

    // ---------------------------------------------------------------- config
    IPoolManager public immutable poolManager;
    uint256 public launchFee = 0.0004 ether;
    uint256 public minFdv = 1 ether; // fully diluted valuation bounds, in ETH
    uint256 public maxFdv = 1_000 ether;
    mapping(address hook => bool) public approvedHook; // address(0) = plain pool, always allowed

    // ---------------------------------------------------------------- state
    struct Launch {
        address creator;
        address hook;
        uint24 fee;
        int24 tickLower;
        int24 tickUpper;
        uint256 holdSnapshot; // creator's token balance right after launch
    }

    struct LaunchParams {
        string name;
        string symbol;
        string metadataURI; // image/links/description; emitted in an event (indexer reads it)
        uint256 fdv; // desired fully diluted valuation in wei of ETH
        uint24 fee; // 10_000 - 50_000
        address hook; // approved hook, or address(0)
    }

    mapping(address token => Launch) public launches;

    // escrow: native-ETH side and token side of accrued fees
    mapping(address token => uint256) public creatorEth;
    mapping(address token => uint256) public creatorToken;
    mapping(address token => uint256) public platformToken;
    uint256 public platformEth;

    enum Action {
        Launch,
        Harvest
    }

    // ---------------------------------------------------------------- events / errors
    event Launched(
        address indexed token,
        address indexed creator,
        string name,
        string symbol,
        string metadataURI,
        uint256 fdv,
        uint24 fee,
        address hook,
        uint256 creatorTokens
    );
    event Harvested(address indexed token, uint256 ethFees, uint256 tokenFees);
    event Claimed(address indexed token, address indexed creator, uint256 ethAmount, uint256 tokenAmount);

    error NotPoolManager();
    error BadFee();
    error BadFdv();
    error HookNotApproved();
    error InsufficientETH();
    error AllocationTooLarge();
    error UnknownToken();
    error HoldGate();
    error TransferFailed();

    constructor(IPoolManager _poolManager, address _owner) Ownable(_owner) {
        poolManager = _poolManager;
    }

    receive() external payable {}

    // ================================================================= LAUNCH
    function launch(LaunchParams calldata p) external payable nonReentrant returns (address token) {
        if (p.fee < MIN_FEE || p.fee > MAX_FEE) revert BadFee();
        if (p.fdv < minFdv || p.fdv > maxFdv) revert BadFdv();
        if (p.hook != address(0) && !approvedHook[p.hook]) revert HookNotApproved();
        if (msg.value <= launchFee) revert InsufficientETH();

        uint256 budget = msg.value - launchFee;
        platformEth += launchFee;

        token = address(new LaunchToken(p.name, p.symbol, address(this)));

        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(address(0)), // native ETH always sorts first
            currency1: Currency.wrap(token),
            fee: p.fee,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(p.hook)
        });

        (int24 tickLower, int24 tickUpper, uint128 liquidity) = _positionFor(p.fdv);
        poolManager.initialize(key, TickMath.getSqrtPriceAtTick(tickUpper));

        bytes memory res = poolManager.unlock(
            abi.encode(Action.Launch, abi.encode(key, tickLower, tickUpper, liquidity, budget, msg.sender))
        );
        (uint256 tokensOut, uint256 ethSpent) = abi.decode(res, (uint256, uint256));

        if (tokensOut * 10_000 > SUPPLY * MAX_CREATOR_ALLOC_BPS) revert AllocationTooLarge();

        launches[token] = Launch({
            creator: msg.sender,
            hook: p.hook,
            fee: p.fee,
            tickLower: tickLower,
            tickUpper: tickUpper,
            holdSnapshot: tokensOut
        });

        // start the anti-snipe window only AFTER the creator's own buy
        if (p.hook != address(0)) IWindowedHook(p.hook).startWindow(key);

        // refund any unused budget
        uint256 refund = budget - ethSpent;
        if (refund > 0) _sendETH(msg.sender, refund);

        emit Launched(token, msg.sender, p.name, p.symbol, p.metadataURI, p.fdv, p.fee, p.hook, tokensOut);
    }

    /// @dev Pool is native ETH (currency0) / token (currency1). Price p = token per ETH = SUPPLY / fdv.
    /// The whole supply sits in [MIN_TICK, tickUpper] with the pool starting AT tickUpper, so the
    /// position holds only tokens. It behaves like a constant-product pool whose virtual ETH
    /// reserve equals `fdv`. Tick spacing 200 means the start price snaps by up to ~2%.
    function _positionFor(uint256 fdv) internal pure returns (int24 tickLower, int24 tickUpper, uint128 liquidity) {
        uint256 ratioX192 = FullMath.mulDiv(SUPPLY, uint256(1) << 192, fdv);
        uint160 sqrtP = uint160(Math.sqrt(ratioX192));
        tickUpper = _floorToSpacing(TickMath.getTickAtSqrtPrice(sqrtP));
        tickLower = (TickMath.MIN_TICK / TICK_SPACING) * TICK_SPACING;
        liquidity = LiquidityAmounts.getLiquidityForAmount1(
            TickMath.getSqrtPriceAtTick(tickLower), TickMath.getSqrtPriceAtTick(tickUpper), SUPPLY
        );
    }

    function _floorToSpacing(int24 tick) internal pure returns (int24) {
        int24 c = tick / TICK_SPACING;
        if (tick < 0 && tick % TICK_SPACING != 0) c--;
        return c * TICK_SPACING;
    }

    // ================================================================= HARVEST / CLAIM
    /// @notice Anyone may call. Sweeps accrued LP fees from the locked position into the 70/30 escrow.
    function harvest(address token) external nonReentrant {
        Launch memory l = launches[token];
        if (l.creator == address(0)) revert UnknownToken();

        PoolKey memory key = _keyOf(token, l);
        bytes memory res = poolManager.unlock(abi.encode(Action.Harvest, abi.encode(key, l.tickLower, l.tickUpper)));
        (uint256 ethFees, uint256 tokenFees) = abi.decode(res, (uint256, uint256));

        uint256 c0 = (ethFees * CREATOR_SHARE_BPS) / 10_000;
        creatorEth[token] += c0;
        platformEth += ethFees - c0;

        uint256 c1 = (tokenFees * CREATOR_SHARE_BPS) / 10_000;
        creatorToken[token] += c1;
        platformToken[token] += tokenFees - c1;

        emit Harvested(token, ethFees, tokenFees);
    }

    /// @notice Anyone may submit; funds always go to the recorded creator.
    /// Hold-to-earn: blocked while the creator's balance is below the post-launch snapshot.
    function claim(address token) external nonReentrant {
        Launch memory l = launches[token];
        if (l.creator == address(0)) revert UnknownToken();
        if (IERC20(token).balanceOf(l.creator) < l.holdSnapshot) revert HoldGate();

        uint256 e = creatorEth[token];
        uint256 t = creatorToken[token];
        creatorEth[token] = 0;
        creatorToken[token] = 0;

        if (e > 0) _sendETH(l.creator, e);
        if (t > 0) IERC20(token).safeTransfer(l.creator, t);
        emit Claimed(token, l.creator, e, t);
    }

    // ================================================================= V4 CALLBACK
    function unlockCallback(bytes calldata raw) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        (Action a, bytes memory d) = abi.decode(raw, (Action, bytes));
        return a == Action.Launch ? _doLaunch(d) : _doHarvest(d);
    }

    function _doLaunch(bytes memory d) internal returns (bytes memory) {
        (PoolKey memory key, int24 lo, int24 hi, uint128 liq, uint256 budget, address creator) =
            abi.decode(d, (PoolKey, int24, int24, uint128, uint256, address));
        address token = Currency.unwrap(key.currency1);

        // 1) add the single-sided (token-only) liquidity; this contract owns the position
        (BalanceDelta addDelta,) = poolManager.modifyLiquidity(
            key,
            ModifyLiquidityParams({tickLower: lo, tickUpper: hi, liquidityDelta: int256(uint256(liq)), salt: bytes32(0)}),
            ""
        );
        uint256 owed = uint256(uint128(-addDelta.amount1()));
        poolManager.sync(key.currency1);
        IERC20(token).safeTransfer(address(poolManager), owed);
        poolManager.settle();

        // rounding dust (a few wei) is burned so no hidden supply remains here
        uint256 dust = IERC20(token).balanceOf(address(this));
        if (dust > 0) IERC20(token).safeTransfer(DEAD, dust);

        // 2) creator's initial buy: exact-input ETH -> token
        BalanceDelta sd = poolManager.swap(
            key,
            SwapParams({zeroForOne: true, amountSpecified: -int256(budget), sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1}),
            ""
        );
        uint256 ethIn = uint256(uint128(-sd.amount0()));
        uint256 tokensOut = uint256(uint128(sd.amount1()));
        poolManager.settle{value: ethIn}();
        poolManager.take(key.currency1, creator, tokensOut);

        return abi.encode(tokensOut, ethIn);
    }

    function _doHarvest(bytes memory d) internal returns (bytes memory) {
        (PoolKey memory key, int24 lo, int24 hi) = abi.decode(d, (PoolKey, int24, int24));

        // liquidityDelta == 0 collects fees without touching the principal
        (BalanceDelta fees,) = poolManager.modifyLiquidity(
            key, ModifyLiquidityParams({tickLower: lo, tickUpper: hi, liquidityDelta: 0, salt: bytes32(0)}), ""
        );
        uint256 a0 = fees.amount0() > 0 ? uint256(uint128(fees.amount0())) : 0;
        uint256 a1 = fees.amount1() > 0 ? uint256(uint128(fees.amount1())) : 0;
        if (a0 > 0) poolManager.take(key.currency0, address(this), a0);
        if (a1 > 0) poolManager.take(key.currency1, address(this), a1);
        return abi.encode(a0, a1);
    }

    function _keyOf(address token, Launch memory l) internal pure returns (PoolKey memory) {
        return PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(token),
            fee: l.fee,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(l.hook)
        });
    }

    // ================================================================= ADMIN (platform only)
    // None of these can touch locked liquidity or creator escrow.
    function setHookApproved(address hook, bool ok) external onlyOwner {
        approvedHook[hook] = ok;
    }

    function setLaunchFee(uint256 fee) external onlyOwner {
        launchFee = fee;
    }

    function setFdvBounds(uint256 _min, uint256 _max) external onlyOwner {
        minFdv = _min;
        maxFdv = _max;
    }

    function withdrawPlatformEth(address to) external onlyOwner nonReentrant {
        uint256 a = platformEth;
        platformEth = 0;
        _sendETH(to, a);
    }

    function withdrawPlatformToken(address token, address to) external onlyOwner nonReentrant {
        uint256 a = platformToken[token];
        platformToken[token] = 0;
        IERC20(token).safeTransfer(to, a);
    }

    function _sendETH(address to, uint256 amount) internal {
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
}
