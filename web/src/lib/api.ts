export const INDEXER = import.meta.env.VITE_INDEXER_URL || import.meta.env.NEXT_PUBLIC_INDEXER_URL || "http://localhost:42069";

export type TokenRow = {
  address: string; creator: string; name: string; symbol: string; image: string; description: string;
  website: string; twitter: string; telegram: string; fee: number; feePercent: number; hook: string; createdAt: number;
  priceEth: number | null; marketCapEth: number | null; volume24hEth: number; change24hPercent: number | null;
};

export type CandleRow = { time: number; open: number; high: number; low: number; close: number; volumeEth: number; trades: number };
export type TokenActivity = {
  period: string;
  trades: number;
  volumeEth: number;
  buys: number;
  sells: number;
  buyVolumeEth: number;
  sellVolumeEth: number;
  openPriceEth: number | null;
  closePriceEth: number | null;
  changePercent: number | null;
};
export type MarketStats = { tokens: number; trades24h: number; volume24hEth: number; updatedAt: number };

export function resolveTokenImage(image: string): string {
  const ipfsPath = image.startsWith("ipfs://")
    ? image.slice("ipfs://".length)
    : image.match(/^https?:\/\/ipfs\.io\/ipfs\/(.+)$/i)?.[1];

  // Use an absolute gateway URL so images also load when the frontend is deployed
  // as a static Vite site without the custom Node server's /api/ipfs proxy route.
  return ipfsPath ? `https://ipfs.io/ipfs/${ipfsPath}` : image;
}

export async function fetchEthUsd(): Promise<number> {
  const response = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd", { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error("ETH/USD reference price is unavailable.");
  const body = await response.json() as { ethereum?: { usd?: number } };
  const price = Number(body.ethereum?.usd);
  if (!Number.isFinite(price) || price <= 0) throw new Error("ETH/USD reference price is invalid.");
  return price;
}

export async function fetchMarketStats(): Promise<MarketStats> {
  const r = await fetch(`${INDEXER}/market`);
  if (!r.ok) throw new Error("Market summary is unavailable.");
  return r.json();
}

export async function fetchCandles(address: string, interval: string): Promise<CandleRow[]> {
  const r = await fetch(`${INDEXER}/tokens/${address}/candles?interval=${interval}&limit=200`);
  if (!r.ok) throw new Error("Price candles are unavailable.");
  return (await r.json()).candles;
}

export async function fetchTokenActivity(address: string, period: string): Promise<TokenActivity> {
  const response = await fetch(`${INDEXER}/tokens/${address}/activity?period=${period}`);
  if (!response.ok) throw new Error("Token activity is unavailable.");
  return response.json();
}

export async function fetchTokenHolders(address: string): Promise<number> {
  const response = await fetch(`${INDEXER}/tokens/${address}/holders`);
  if (!response.ok) throw new Error("Token holder count is unavailable.");
  const body = await response.json() as { holders: number };
  return body.holders;
}

export async function fetchTokens(sort: string, q: string): Promise<TokenRow[]> {
  const r = await fetch(`${INDEXER}/tokens?sort=${sort}&q=${encodeURIComponent(q)}&limit=50`);
  if (!r.ok) throw new Error("The indexer isn't responding.");
  return (await r.json()).tokens;
}

export const fmtEth = (n: number | null) => (n == null ? "–" : n >= 100 ? n.toFixed(0) : n >= 1 ? n.toFixed(2) : n === 0 ? "0" : n.toPrecision(3));

export const fmtUsd = (n: number | null | undefined) => n == null || !Number.isFinite(n)
  ? "—"
  : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumSignificantDigits: 4 }).format(n);

export function ago(ts: number) {
  const s = Math.max(0, Math.floor(Date.now() / 1000) - ts);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export type SwapRow = { ts: number; tx: string; eth: number; isBuy: number; priceEth: number };

export async function fetchToken(address: string): Promise<{ token: TokenRow; swaps: SwapRow[] }> {
  const r = await fetch(`${INDEXER}/tokens/${address}?swaps=300`);
  if (r.status === 404) throw new Error("This token isn't in the index yet. If you just launched it, wait a few seconds.");
  if (!r.ok) throw new Error("The indexer isn't responding.");
  return r.json();
}
