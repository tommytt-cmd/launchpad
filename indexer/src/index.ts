import Database from "better-sqlite3";
import http from "node:http";
import {
  createPublicClient, http as rpc, parseAbiItem, keccak256, encodeAbiParameters, formatEther, zeroAddress,
  type Address, type Hex,
} from "viem";

// ------------------------------------------------------------------ config
const need = (k: string, d?: string) => {
  const v = process.env[k] ?? d;
  if (v === undefined || v === "") throw new Error(`Set ${k} in .env`);
  return v;
};
const FACTORY = need("FACTORY") as Address;
const POOL_MANAGER = need("POOL_MANAGER") as Address;
const START = BigInt(need("START_BLOCK"));
const RANGE = BigInt(need("BLOCK_RANGE", "2000"));
const PORT = Number(need("PORT", "42069"));
const EXPLORER_URL = (process.env.EXPLORER_URL || "https://explorer.testnet.chain.robinhood.com").replace(/\/+$/, "");
const TICK_SPACING = 200; // must match LaunchFactory
const SUPPLY = 1e9;
const client = createPublicClient({ transport: rpc(need("RPC_URL")) });

const launchedEvent = parseAbiItem(
  "event Launched(address indexed token, address indexed creator, string name, string symbol, string metadataURI, uint256 fdv, uint24 fee, address hook, uint256 creatorTokens)"
);
// Uniswap V4 PoolManager emits every swap for every pool; we filter by our pool ids.
const swapEvent = parseAbiItem(
  "event Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee)"
);

// V4 pool id = keccak256(abi.encode(PoolKey)). Pools here are always native ETH / token.
const poolIdOf = (token: Address, fee: number, hook: Address): Hex =>
  keccak256(
    encodeAbiParameters(
      [{ type: "address" }, { type: "address" }, { type: "uint24" }, { type: "int24" }, { type: "address" }],
      [zeroAddress, token, fee, TICK_SPACING, hook]
    )
  );

// ------------------------------------------------------------------ database
const db = new Database(process.env.DB_PATH || "indexer.db");
db.pragma("journal_mode = WAL");
db.exec(`
CREATE TABLE IF NOT EXISTS tokens(
  address TEXT PRIMARY KEY, creator TEXT, name TEXT, symbol TEXT, image TEXT, description TEXT,
  website TEXT, twitter TEXT, telegram TEXT, fdv TEXT, fee INTEGER, hook TEXT, creator_tokens TEXT,
  pool_id TEXT UNIQUE, created_at INTEGER, block INTEGER, price_eth REAL);
CREATE TABLE IF NOT EXISTS swaps(
  id INTEGER PRIMARY KEY AUTOINCREMENT, token TEXT, ts INTEGER, tx TEXT, log_index INTEGER,
  eth REAL, is_buy INTEGER, price_eth REAL, UNIQUE(tx, log_index));
CREATE INDEX IF NOT EXISTS swaps_token_ts ON swaps(token, ts);
CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT);`);

const getMeta = (k: string) => (db.prepare("SELECT v FROM meta WHERE k=?").get(k) as { v: string } | undefined)?.v;
const setMeta = (k: string, v: string) => db.prepare("INSERT OR REPLACE INTO meta(k,v) VALUES(?,?)").run(k, v);

const pools = new Map<string, string>(
  (db.prepare("SELECT pool_id, address FROM tokens").all() as { pool_id: string; address: string }[]).map((r) => [r.pool_id, r.address])
);
const insToken = db.prepare(`INSERT OR IGNORE INTO tokens
  (address,creator,name,symbol,image,description,website,twitter,telegram,fdv,fee,hook,creator_tokens,pool_id,created_at,block)
  VALUES (@address,@creator,@name,@symbol,@image,@description,@website,@twitter,@telegram,@fdv,@fee,@hook,@creator_tokens,@pool_id,@created_at,@block)`);
const insSwap = db.prepare("INSERT OR IGNORE INTO swaps(token,ts,tx,log_index,eth,is_buy,price_eth) VALUES (?,?,?,?,?,?,?)");
const getPrice = db.prepare("SELECT price_eth FROM tokens WHERE address=?");
const setPrice = db.prepare("UPDATE tokens SET price_eth=? WHERE address=?");

// ------------------------------------------------------------------ helpers
const tsCache = new Map<bigint, number>();
async function blockTs(n: bigint) {
  let t = tsCache.get(n);
  if (t === undefined) {
    t = Number((await client.getBlock({ blockNumber: n })).timestamp);
    if (tsCache.size > 5000) tsCache.clear();
    tsCache.set(n, t);
  }
  return t;
}

// Metadata is user-supplied: keep only short strings and http(s)/ipfs links.
function parseMeta(uri: string) {
  let m: Record<string, unknown> = {};
  try {
    if (uri.startsWith("data:application/json;base64,")) m = JSON.parse(Buffer.from(uri.split(",")[1], "base64").toString("utf8"));
  } catch {}
  const s = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
  const url = (v: unknown) => {
    const u = s(v, 300);
    if (u.startsWith("ipfs://")) return "https://ipfs.io/ipfs/" + u.slice(7);
    return /^https?:\/\//.test(u) ? u : "";
  };
  return { image: url(m.image), description: s(m.description, 280), website: url(m.website), twitter: s(m.twitter, 100), telegram: s(m.telegram, 100) };
}

type TokenRow = {
  address: string;
  creator: string;
  name: string;
  symbol: string;
  image: string;
  description: string;
  website: string;
  twitter: string;
  telegram: string;
  fdv: string;
  fee: number;
  hook: string;
  creator_tokens: string;
  pool_id: string;
  created_at: number;
  block: number;
};

// ------------------------------------------------------------------ indexing
async function indexRange(from: bigint, to: bigint) {
  // 1) new launches first, so their pools are known before we look for swaps in the same block
  const launches = await client.getLogs({ address: FACTORY, event: launchedEvent, fromBlock: from, toBlock: to });
  const rows: TokenRow[] = [];
  for (const l of launches) {
    const a = l.args as any;
    rows.push({
      address: a.token.toLowerCase(), creator: a.creator.toLowerCase(), name: String(a.name).slice(0, 60), symbol: String(a.symbol).slice(0, 12),
      ...parseMeta(a.metadataURI), fdv: a.fdv.toString(), fee: Number(a.fee), hook: a.hook.toLowerCase(),
      creator_tokens: a.creatorTokens.toString(), pool_id: poolIdOf(a.token, Number(a.fee), a.hook),
      created_at: await blockTs(l.blockNumber!), block: Number(l.blockNumber),
    });
  }
  db.transaction(() => rows.forEach((r) => { insToken.run(r); pools.set(r.pool_id, r.address); }))();

  // 2) swaps for known pools (topic-filtered in chunks to keep requests small)
  const ids = [...pools.keys()] as Hex[];
  const logs: Awaited<ReturnType<typeof client.getLogs<typeof swapEvent>>> = [];
  for (let i = 0; i < ids.length; i += 100)
    logs.push(...(await client.getLogs({ address: POOL_MANAGER, event: swapEvent, args: { id: ids.slice(i, i + 100) }, fromBlock: from, toBlock: to })));
  logs.sort((a, b) => Number(a.blockNumber! - b.blockNumber!) || a.logIndex! - b.logIndex!);

  const batch: any[] = [];
  for (const l of logs) batch.push({ l, ts: await blockTs(l.blockNumber!) });
  db.transaction(() => {
    for (const { l, ts } of batch) {
      const token = pools.get(l.args.id as string);
      if (!token) continue;
      const a0 = l.args.amount0!;
      const eth = Number(formatEther(a0 < 0n ? -a0 : a0));
      const p = Number(l.args.sqrtPriceX96!) / 2 ** 96;
      const price = 1 / (p * p); // ETH per token (pool price is token per ETH)
      const prev = (getPrice.get(token) as { price_eth: number | null }).price_eth;
      // direction from price movement, so we don't depend on the event's sign convention.
      // The first swap of every pool is the creator's initial buy.
      const isBuy = prev == null || price > prev ? 1 : 0;
      if (insSwap.run(token, ts, l.transactionHash, l.logIndex, eth, isBuy, price).changes) setPrice.run(price, token);
    }
  })();
}

async function sync() {
  let last = BigInt(getMeta("last") ?? (START - 1n).toString());
  const head = await client.getBlockNumber();
  while (last < head) {
    const to = last + RANGE > head ? head : last + RANGE;
    await indexRange(last + 1n, to);
    setMeta("last", to.toString());
    last = to;
    if (head - last > 0n) console.log(`indexed to ${last} / ${head}`);
  }
}
(async () => {
  for (;;) {
    try { await sync(); } catch (e) { console.error("sync error:", (e as Error).message); }
    await new Promise((r) => setTimeout(r, 2000));
  }
})();

// ------------------------------------------------------------------ HTTP API
const send = (res: http.ServerResponse, code: number, body: unknown) => {
  res.writeHead(code, { "content-type": "application/json", "access-control-allow-origin": "*" });
  res.end(JSON.stringify(body));
};
const shape = (r: any) => ({
  address: r.address, creator: r.creator, name: r.name, symbol: r.symbol, image: r.image, description: r.description,
  website: r.website, twitter: r.twitter, telegram: r.telegram, fee: r.fee, feePercent: r.fee / 10000, hook: r.hook,
  createdAt: r.created_at, priceEth: r.price_eth, marketCapEth: r.price_eth == null ? null : r.price_eth * SUPPLY,
  volume24hEth: r.vol24 ?? 0,
  change24hPercent: r.open24 == null || r.close24 == null || r.open24 === 0 ? null : ((r.close24 / r.open24) - 1) * 100,
});
const VOL = "COALESCE((SELECT SUM(eth) FROM swaps s WHERE s.token=t.address AND s.ts>?),0)";
const CHANGE24H = `COALESCE(
  (SELECT price_eth FROM swaps WHERE token=t.address AND ts<=? ORDER BY ts DESC,id DESC LIMIT 1),
  (SELECT price_eth FROM swaps WHERE token=t.address AND ts>=? ORDER BY ts ASC,id ASC LIMIT 1)
) AS open24,
(SELECT price_eth FROM swaps WHERE token=t.address AND ts>=? ORDER BY ts DESC,id DESC LIMIT 1) AS close24`;
const ORDER: Record<string, string> = { new: "t.created_at DESC", volume: "vol24 DESC", mcap: "t.price_eth DESC" };
const CANDLE_INTERVALS: Record<string, number> = { "1m": 60, "5m": 300, "15m": 900, "1h": 3600, "4h": 14400, "1d": 86400 };
const ACTIVITY_PERIODS: Record<string, number> = { "5m": 300, "1h": 3600, "6h": 21600, "24h": 86400 };

function buildCandles(token: string, interval: number, limit: number) {
  const cutoff = Math.floor(Date.now() / 1000) - interval * limit;
  const rows = db.prepare(`SELECT ts, tx, log_index, eth, price_eth FROM swaps
    WHERE token=? AND ts>=? ORDER BY ts DESC, id DESC LIMIT ?`).all(token, cutoff, limit * 500) as {
      ts: number; tx: string; log_index: number; eth: number; price_eth: number;
    }[];
  const candles = new Map<number, { time: number; open: number; high: number; low: number; close: number; volumeEth: number; trades: number }>();
  for (const row of rows.reverse()) {
    const time = Math.floor(row.ts / interval) * interval;
    const candle = candles.get(time);
    if (!candle) candles.set(time, { time, open: row.price_eth, high: row.price_eth, low: row.price_eth, close: row.price_eth, volumeEth: row.eth, trades: 1 });
    else {
      candle.high = Math.max(candle.high, row.price_eth);
      candle.low = Math.min(candle.low, row.price_eth);
      candle.close = row.price_eth;
      candle.volumeEth += row.eth;
      candle.trades += 1;
    }
  }
  return [...candles.values()].slice(-limit);
}

http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url!, "http://x");
    const since = Math.floor(Date.now() / 1000) - 86400;
    if (u.pathname === "/health") return send(res, 200, { ok: true, lastBlock: getMeta("last") });
    if (u.pathname === "/market") {
      const tokens = (db.prepare("SELECT COUNT(*) AS count FROM tokens").get() as { count: number }).count;
      const activity = db.prepare("SELECT COUNT(*) AS trades, COALESCE(SUM(eth),0) AS volumeEth FROM swaps WHERE ts>? ").get(since) as { trades: number; volumeEth: number };
      return send(res, 200, { tokens, trades24h: activity.trades, volume24hEth: activity.volumeEth, updatedAt: Math.floor(Date.now() / 1000) });
    }
    if (u.pathname === "/tokens") {
      const q = (u.searchParams.get("q") || "").trim().slice(0, 60);
      const limit = Math.min(Math.max(Number(u.searchParams.get("limit")) || 50, 1), 100);
      const offset = Math.max(Number(u.searchParams.get("offset")) || 0, 0);
      const order = ORDER[u.searchParams.get("sort") || "new"] || ORDER.new;
      const like = `%${q.replace(/[%_]/g, "")}%`;
      const rows = db.prepare(`SELECT t.*, ${VOL} AS vol24, ${CHANGE24H} FROM tokens t
        WHERE (? = '' OR t.name LIKE ? OR t.symbol LIKE ? OR t.address = ?)
        ORDER BY ${order} LIMIT ? OFFSET ?`).all(since, since, since, since, q, like, like, q.toLowerCase(), limit, offset);
      return send(res, 200, { tokens: rows.map(shape) });
    }
    const holdersMatch = u.pathname.match(/^\/tokens\/(0x[0-9a-fA-F]{40})\/holders$/);
    if (holdersMatch) {
      const token = holdersMatch[1].toLowerCase();
      if (!db.prepare("SELECT 1 FROM tokens WHERE address=?").get(token)) return send(res, 404, { error: "unknown token" });
      const response = await fetch(`${EXPLORER_URL}/api/v2/tokens/${token}`, { signal: AbortSignal.timeout(8000) });
      if (!response.ok) return send(res, 502, { error: "holder data is unavailable" });
      const tokenData = await response.json() as { holders_count?: string | number | null };
      if (tokenData.holders_count == null) return send(res, 502, { error: "holder count is unavailable" });
      const holders = Number(tokenData.holders_count);
      if (!Number.isSafeInteger(holders) || holders < 0) return send(res, 502, { error: "holder count is unavailable" });
      return send(res, 200, { holders });
    }
    const m = u.pathname.match(/^\/tokens\/(0x[0-9a-fA-F]{40})$/);
    if (m) {
      const addr = m[1].toLowerCase();
      const r = db.prepare(`SELECT t.*, ${VOL} AS vol24, ${CHANGE24H} FROM tokens t WHERE t.address=?`).get(since, since, since, since, addr);
      if (!r) return send(res, 404, { error: "unknown token" });
      const swaps = db.prepare("SELECT ts, tx, eth, is_buy AS isBuy, price_eth AS priceEth FROM swaps WHERE token=? ORDER BY ts DESC, id DESC LIMIT ?").all(addr, Math.min(Math.max(Number(u.searchParams.get("swaps")) || 50, 1), 500));
      return send(res, 200, { token: shape(r), swaps });
    }
    const activityMatch = u.pathname.match(/^\/tokens\/(0x[0-9a-fA-F]{40})\/activity$/);
    if (activityMatch) {
      const addr = activityMatch[1].toLowerCase();
      const periodName = u.searchParams.get("period") || "1h";
      const periodSeconds = ACTIVITY_PERIODS[periodName];
      if (!periodSeconds) return send(res, 400, { error: "period must be one of 5m, 1h, 6h, 24h" });
      if (!db.prepare("SELECT 1 FROM tokens WHERE address=?").get(addr)) return send(res, 404, { error: "unknown token" });
      const cutoff = Math.floor(Date.now() / 1000) - periodSeconds;
      const activity = db.prepare(`SELECT COUNT(*) AS trades,
        COALESCE(SUM(eth),0) AS volumeEth,
        SUM(CASE WHEN is_buy=1 THEN 1 ELSE 0 END) AS buys,
        SUM(CASE WHEN is_buy=0 THEN 1 ELSE 0 END) AS sells,
        COALESCE(SUM(CASE WHEN is_buy=1 THEN eth ELSE 0 END),0) AS buyVolumeEth,
        COALESCE(SUM(CASE WHEN is_buy=0 THEN eth ELSE 0 END),0) AS sellVolumeEth,
        COALESCE(
          (SELECT price_eth FROM swaps WHERE token=? AND ts<=? ORDER BY ts DESC,id DESC LIMIT 1),
          (SELECT price_eth FROM swaps WHERE token=? AND ts>=? ORDER BY ts ASC,id ASC LIMIT 1)
        ) AS openPriceEth,
        (SELECT price_eth FROM swaps WHERE token=? AND ts>=? ORDER BY ts DESC,id DESC LIMIT 1) AS closePriceEth
        FROM swaps WHERE token=? AND ts>=?`).get(addr, cutoff, addr, cutoff, addr, cutoff, addr, cutoff) as {
          trades: number; volumeEth: number; buys: number | null; sells: number | null;
          buyVolumeEth: number; sellVolumeEth: number; openPriceEth: number | null; closePriceEth: number | null;
        };
      const changePercent = activity.openPriceEth == null || activity.closePriceEth == null || activity.openPriceEth === 0
        ? null
        : ((activity.closePriceEth / activity.openPriceEth) - 1) * 100;
      return send(res, 200, { period: periodName, ...activity, buys: activity.buys ?? 0, sells: activity.sells ?? 0, changePercent });
    }
    const candleMatch = u.pathname.match(/^\/tokens\/(0x[0-9a-fA-F]{40})\/candles$/);
    if (candleMatch) {
      const addr = candleMatch[1].toLowerCase();
      const intervalName = u.searchParams.get("interval") || "1h";
      const interval = CANDLE_INTERVALS[intervalName];
      if (!interval) return send(res, 400, { error: "interval must be one of 1m, 5m, 15m, 1h, 4h, 1d" });
      const limit = Math.min(Math.max(Number(u.searchParams.get("limit")) || 200, 1), 500);
      if (!db.prepare("SELECT 1 FROM tokens WHERE address=?").get(addr)) return send(res, 404, { error: "unknown token" });
      return send(res, 200, { interval: intervalName, candles: buildCandles(addr, interval, limit) });
    }
    send(res, 404, { error: "not found" });
  } catch (e) {
    console.error(e);
    send(res, 500, { error: "server error" });
  }
}).listen(PORT, () => console.log(`indexer API on :${PORT}`));
