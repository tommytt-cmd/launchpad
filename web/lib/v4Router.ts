import {
  encodeAbiParameters,
  parseAbi,
  parseAbiParameters,
  zeroAddress,
  type Hex,
} from "viem";

export type V4PoolKey = {
  currency0: Hex;
  currency1: Hex;
  fee: number;
  tickSpacing: number;
  hooks: Hex;
};

export type SwapDirection = "buy" | "sell";

export const universalRouterAbi = parseAbi([
  "function execute(bytes commands, bytes[] inputs) payable",
]);

export const v4QuoterAbi = parseAbi([
  "function quoteExactInputSingle(((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns (uint256 amountOut,uint256 gasEstimate)",
]);

export const tokenApprovalAbi = parseAbi([
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);

export const permit2Abi = parseAbi([
  "function allowance(address user, address token, address spender) view returns (uint160 amount, uint48 expiration, uint48 nonce)",
  "function approve(address token, address spender, uint160 amount, uint48 expiration)",
]);

const swapParamsAbi = parseAbiParameters(
  "((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 amountIn,uint128 amountOutMinimum,uint256 minHopPriceX36,bytes hookData)",
);

export function buildPoolKey(token: Hex, fee: number, hook?: Hex): V4PoolKey {
  return {
    currency0: zeroAddress,
    currency1: token,
    fee,
    tickSpacing: 200,
    hooks: hook ?? zeroAddress,
  };
}

export function buildUniversalRouterExactInputSingle(
  token: Hex,
  fee: number,
  direction: SwapDirection,
  amountIn: bigint,
  minOut: bigint,
  recipient: Hex,
  hook?: Hex,
) {
  const key = buildPoolKey(token, fee, hook);
  const inputCurrency = direction === "buy" ? key.currency0 : key.currency1;
  const outputCurrency = direction === "buy" ? key.currency1 : key.currency0;
  const actions = "0x060c0e" as Hex;
  const swapParams = encodeAbiParameters(swapParamsAbi, [{
    poolKey: key,
    zeroForOne: direction === "buy",
    amountIn,
    amountOutMinimum: minOut,
    minHopPriceX36: 0n,
    hookData: "0x",
  }]);
  const actionParams = [
    swapParams,
    encodeAbiParameters(parseAbiParameters("address currency,uint256 maxAmount"), [inputCurrency, amountIn]),
    encodeAbiParameters(parseAbiParameters("address currency,address recipient,uint256 amount"), [
      outputCurrency,
      recipient,
      0n,
    ]),
  ];

  return {
    commands: "0x10" as Hex,
    inputs: [encodeAbiParameters(parseAbiParameters("bytes actions,bytes[] params"), [actions, actionParams])],
    value: direction === "buy" ? amountIn : 0n,
  };
}
