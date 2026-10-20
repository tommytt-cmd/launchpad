import { defineChain, parseAbi, BaseError, ContractFunctionRevertedError } from "viem";

const RH_TESTNET = {
  chainId: 46630,
  chainName: "Robinhood Chain Testnet",
  rpcUrl: "https://rpc.testnet.chain.robinhood.com",
  explorer: "https://explorer.testnet.chain.robinhood.com",
  factory: "0xb40216a118954516D7D40Ad507728d08AC51BD85",
  hook: "0xF2875076a5ad187Cb9732f04864Cb6b94aa18040",
  poolManager: "0x62D81f7e973486e37cdC66ad5Af7114C6e542692",
  v4Router: "0x8AC91Ab2b7aF520Db706CADc78FD79DaB8F467dB",
  v4Quoter: "0x703686768a093c95737aF8F47E1D1FFdE30d778c",
  permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
} as const;

export const chain = defineChain({
  id: Number(process.env.NEXT_PUBLIC_CHAIN_ID || RH_TESTNET.chainId),
  name: process.env.NEXT_PUBLIC_CHAIN_NAME || RH_TESTNET.chainName,
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [process.env.NEXT_PUBLIC_RPC_URL || RH_TESTNET.rpcUrl] } },
  blockExplorers: {
    default: { name: "Robinhood Explorer", url: process.env.NEXT_PUBLIC_EXPLORER || RH_TESTNET.explorer },
  },
});

export const FACTORY = (process.env.NEXT_PUBLIC_FACTORY || RH_TESTNET.factory) as `0x${string}`;
export const HOOK = (process.env.NEXT_PUBLIC_ANTISNIPE_HOOK || RH_TESTNET.hook) as `0x${string}` | "";
export const POOL_MANAGER = (process.env.NEXT_PUBLIC_POOL_MANAGER || RH_TESTNET.poolManager) as `0x${string}`;
export const V4_ROUTER = (process.env.NEXT_PUBLIC_V4_ROUTER || RH_TESTNET.v4Router) as `0x${string}` | "";
export const V4_QUOTER = (process.env.NEXT_PUBLIC_V4_QUOTER || RH_TESTNET.v4Quoter) as `0x${string}` | "";
export const PERMIT2 = (process.env.NEXT_PUBLIC_PERMIT2 || RH_TESTNET.permit2) as `0x${string}`;
export const CONFIGURED = FACTORY.length === 42 && chain.id === RH_TESTNET.chainId;

export const factoryAbi = parseAbi([
  "function launch((string name, string symbol, string metadataURI, uint256 fdv, uint24 fee, address hook) p) payable returns (address token)",
  "function launchFee() view returns (uint256)",
  "function minFdv() view returns (uint256)",
  "function maxFdv() view returns (uint256)",
  "function launches(address) view returns (address creator, address hook, uint24 fee, int24 tickLower, int24 tickUpper, uint256 holdSnapshot)",
  "function creatorEth(address) view returns (uint256)",
  "function creatorToken(address) view returns (uint256)",
  "function harvest(address token)",
  "function claim(address token)",
  "event Launched(address indexed token, address indexed creator, string name, string symbol, string metadataURI, uint256 fdv, uint24 fee, address hook, uint256 creatorTokens)",
  "error BadFee()", "error BadFdv()", "error HookNotApproved()", "error InsufficientETH()",
  "error AllocationTooLarge()", "error UnknownToken()", "error HoldGate()", "error TransferFailed()",
]);

const FRIENDLY: Record<string, string> = {
  BadFee: "Fee must be between 1% and 5%.",
  BadFdv: "Starting valuation is outside the allowed range.",
  HookNotApproved: "That launch protection isn't approved on the factory.",
  InsufficientETH: "Not enough ETH to cover the launch fee and your buy.",
  AllocationTooLarge: "Your first buy would exceed 10% of supply. Lower it or raise the valuation.",
  UnknownToken: "This token wasn't launched through this factory.",
  HoldGate: "Claims are blocked until the creator's balance is back at the launch amount.",
};

export function friendlyError(e: unknown): string {
  if (e instanceof BaseError) {
    const r = e.walk((x) => x instanceof ContractFunctionRevertedError);
    if (r instanceof ContractFunctionRevertedError && r.data?.errorName)
      return FRIENDLY[r.data.errorName] || r.data.errorName;
    return e.shortMessage;
  }
  return e instanceof Error ? e.message : String(e);
}
