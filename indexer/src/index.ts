import http from "node:http";
import pg from "pg";
import {
  createPublicClient, http as rpc, parseAbiItem, keccak256, encodeAbiParameters, formatEther, zeroAddress,
  type Address, type Hex,
} from "viem";

// ------------------------------------------------------------------ config
const need = (k: string, d?: string) => {
  const v = process.env[k] ?? d;
  if (v === undefined || v === "") throw new Error(`Set ${k} as an environment variable`);
  return v;
};
const FACTORY = need("FACTORY") as Address;
const POOL_MANAGER = need("POOL_MANAGER") as Address;
const START = BigInt(need("START_BLOCK"));
const RANGE = BigInt(need("BLOCK_RANGE", "2000"));
const PORT = Number(need("PORT", "42069"));
const DATABASE_URL = need("DATABASE_URL");
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
const { Pool } = pg;
const db = new Pool({ connectionString: DATABASE_URL, max: 5 });
const pools = new Map<string, string>();
let lastIndexedBlock: string | null = null;

async function initializeDatabase() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS tokens(
      address TEXT PRIMARY KEY, creator TEXT NOT NULL, name TEXT NOT NULL, symbol TEXT NOT NULL,
      image TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '', website TEXT NOT NULL DEFAULT '',
      twitter TEXT NOT NULL DEFAULT '', telegram TEXT NOT NULL DEFAULT '', fdv TEXT NOT NULL,
      fee INTEGER NOT NULL, hook TEXT NOT NULL, creator_tokens TEXT NOT NULL,
      pool_id TEXT UNIQUE NOT NULL, created_at BIGINT NOT NULL, block BIGINT NOT NULL, price_eth DOUBLE PRECISION);
    CREATE TABLE IF NOT EXISTS swaps(
      id BIGSERIAL PRIMARY KEY, token TEXT NOT NULL REFERENCES tokens(address), ts BIGINT NOT NULL,
      tx TEXT NOT NULL, log_index INTEGER NOT NULL, eth DOUBLE PRECISION NOT NULL,
      is_buy INTEGER NOT NULL, price_eth DOUBLE PRECISION NOT NULL, UNIQUE(tx, log_index));
    CREATE INDEX IF NOT EXISTS swaps_token_ts ON swaps(token, ts);
    CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT NOT NULL);
    ALTER TABLE public.tokens ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.swaps ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.meta ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON TABLE public.tokens, public.swaps, public.meta FROM anon, authenticated;
    REVOKE ALL ON SEQUENCE public.swaps_id_seq FROM anon, authenticated;
  `);
  const existingPools = await db.query<{ pool_id: string; address: string }>("SELECT pool_id, address FROM tokens");
  for (const row of existingPools.rows) pools.set(row.pool_id, row.address);
  const meta = await db.query<{ v: string }>("SELECT v FROM meta WHERE k=$1", ["last"]);
  lastIndexedBlock = meta.rows[0]?.v ?? null;
}

async function getMeta(k: string): Promise<string | undefined> {
  const result = await db.query<{ v: string }>("SELECT v FROM meta WHERE k=$1", [k]);
  return result.rows[0]?.v;
}

async function setMeta(k: string, v: string) {
  await db.query("INSERT INTO meta(k,v) VALUES($1,$2) ON CONFLICT(k) DO UPDATE SET v=EXCLUDED.v", [k, v]);
  if (k === "last") lastIndexedBlock = v;
}

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
  if (rows.length) {
    const connection = await db.connect();
    try {
      await connection.query("BEGIN");
      for (const r of rows) {
        await connection.query(`INSERT INTO tokens
          (address,creator,name,symbol,image,description,website,twitter,telegram,fdv,fee,hook,creator_tokens,pool_id,created_at,block)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) ON CONFLICT(address) DO NOTHING`,
        [r.address,r.creator,r.name,r.symbol,r.image,r.description,r.website,r.twitter,r.telegram,r.fdv,r.fee,r.hook,r.creator_tokens,r.pool_id,r.created_at,r.block]);
      }
      await connection.query("COMMIT");
      for (const r of rows) pools.set(r.pool_id, r.address);
    } catch (error) {
      await connection.query("ROLLBACK");
      throw error;
    } finally {
      connection.release();
    }
  }

  // 2) swaps for known pools (topic-filtered in chunks to keep requests small)
  const ids = [...pools.keys()] as Hex[];
  const logs: Awaited<ReturnType<typeof client.getLogs<typeof swapEvent>>> = [];
  for (let i = 0; i < ids.length; i += 100)
    logs.push(...(await client.getLogs({ address: POOL_MANAGER, event: swapEvent, args: { id: ids.slice(i, i + 100) }, fromBlock: from, toBlock: to })));
  logs.sort((a, b) => Number(a.blockNumber! - b.blockNumber!) || a.logIndex! - b.logIndex!);

  const batch: { l: (typeof logs)[number]; ts: number }[] = [];
  for (const l of logs) batch.push({ l, ts: await blockTs(l.blockNumber!) });
  if (batch.length) {
    const connection = await db.connect();
    try {
      await connection.query("BEGIN");
      for (const { l, ts } of batch) {
      const token = pools.get(l.args.id as string);
      if (!token) continue;
      const a0 = l.args.amount0!;
      const eth = Number(formatEther(a0 < 0n ? -a0 : a0));
      const p = Number(l.args.sqrtPriceX96!) / 2 ** 96;
      const price = 1 / (p * p); // ETH per token (pool price is token per ETH)
      const prevResult = await connection.query<{ price_eth: number | null }>("SELECT price_eth FROM tokens WHERE address=$1", [token]);
      const prev = prevResult.rows[0]?.price_eth ?? null;
      // direction from price movement, so we don't depend on the event's sign convention.
      // The first swap of every pool is the creator's initial buy.
      const isBuy = prev == null || price > prev ? 1 : 0;
      const inserted = await connection.query("INSERT INTO swaps(token,ts,tx,log_index,eth,is_buy,price_eth) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(tx,log_index) DO NOTHING RETURNING id",
        [token,ts,l.transactionHash,l.logIndex,eth,isBuy,price]);
      if (inserted.rowCount) await connection.query("UPDATE tokens SET price_eth=$1 WHERE address=$2", [price, token]);
      }
      await connection.query("COMMIT");
    } catch (error) {
      await connection.query("ROLLBACK");
      throw error;
    } finally {
      connection.release();
    }
  }
}

async function sync() {
  let last = BigInt((await getMeta("last")) ?? (START - 1n).toString());
  const head = await client.getBlockNumber();
  while (last < head) {
    const to = last + RANGE > head ? head : last + RANGE;
    await indexRange(last + 1n, to);
    await setMeta("last", to.toString());
    last = to;
    if (head - last > 0n) console.log(`indexed to ${last} / ${head}`);
  }
}
// ------------------------------------------------------------------ HTTP API
const send = (res: http.ServerResponse, code: number, body: unknown) => {
  res.writeHead(code, { "content-type": "application/json", "access-control-allow-origin": "*" });
  res.end(JSON.stringify(body));
};
const shape = (r: any) => ({
  address: r.address, creator: r.creator, name: r.name, symbol: r.symbol, image: r.image, description: r.description,
  website: r.website, twitter: r.twitter, telegram: r.telegram, fee: r.fee, feePercent: r.fee / 10000, hook: r.hook,
  createdAt: Number(r.created_at), priceEth: r.price_eth, marketCapEth: r.price_eth == null ? null : r.price_eth * SUPPLY,
  volume24hEth: r.vol24 ?? 0,
  change24hPercent: r.open24 == null || r.close24 == null || r.open24 === 0 ? null : ((r.close24 / r.open24) - 1) * 100,
});
const ORDER: Record<string, string> = { new: "t.created_at DESC", volume: "vol24 DESC", mcap: "t.price_eth DESC" };
const CANDLE_INTERVALS: Record<string, number> = { "1m": 60, "5m": 300, "15m": 900, "1h": 3600, "4h": 14400, "1d": 86400 };
const ACTIVITY_PERIODS: Record<string, number> = { "5m": 300, "1h": 3600, "6h": 21600, "24h": 86400 };

async function buildCandles(token: string, interval: number, limit: number) {
  const cutoff = Math.floor(Date.now() / 1000) - interval * limit;
  const result = await db.query<{ ts: number; tx: string; log_index: number; eth: number; price_eth: number }>(`SELECT ts, tx, log_index, eth, price_eth FROM swaps
    WHERE token=$1 AND ts>=$2 ORDER BY ts DESC, id DESC LIMIT $3`, [token, cutoff, limit * 500]);
  const rows = result.rows as {
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

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url!, "http://x");
    const since = Math.floor(Date.now() / 1000) - 86400;
    if (u.pathname === "/health") return send(res, 200, { ok: true, lastBlock: lastIndexedBlock });
    if (u.pathname === "/market") {
      const tokens = await db.query<{ count: string }>("SELECT COUNT(*) AS count FROM tokens");
      const activity = await db.query<{ trades: string; volumeeth: number }>("SELECT COUNT(*) AS trades, COALESCE(SUM(eth),0)::double precision AS volumeeth FROM swaps WHERE ts>$1", [since]);
      return send(res, 200, { tokens: Number(tokens.rows[0].count), trades24h: Number(activity.rows[0].trades), volume24hEth: Number(activity.rows[0].volumeeth), updatedAt: Math.floor(Date.now() / 1000) });
    }
    if (u.pathname === "/tokens") {
      const q = (u.searchParams.get("q") || "").trim().slice(0, 60);
      const limit = Math.min(Math.max(Number(u.searchParams.get("limit")) || 50, 1), 100);
      const offset = Math.max(Number(u.searchParams.get("offset")) || 0, 0);
      const order = ORDER[u.searchParams.get("sort") || "new"] || ORDER.new;
      const like = `%${q.replace(/[%_]/g, "")}%`;
      const rows = await db.query(`SELECT t.*,
          COALESCE((SELECT SUM(eth) FROM swaps s WHERE s.token=t.address AND s.ts>$1),0)::double precision AS vol24,
          COALESCE((SELECT price_eth FROM swaps WHERE token=t.address AND ts<=$1 ORDER BY ts DESC,id DESC LIMIT 1),
                   (SELECT price_eth FROM swaps WHERE token=t.address AND ts>=$1 ORDER BY ts ASC,id ASC LIMIT 1)) AS open24,
          (SELECT price_eth FROM swaps WHERE token=t.address AND ts>=$1 ORDER BY ts DESC,id DESC LIMIT 1) AS close24
        FROM tokens t WHERE ($2 = '' OR t.name ILIKE $3 OR t.symbol ILIKE $3 OR t.address = $4)
        ORDER BY ${order} LIMIT $5 OFFSET $6`, [since, q, like, q.toLowerCase(), limit, offset]);
      return send(res, 200, { tokens: rows.rows.map(shape) });
    }
    const holdersMatch = u.pathname.match(/^\/tokens\/(0x[0-9a-fA-F]{40})\/holders$/);
    if (holdersMatch) {
      const token = holdersMatch[1].toLowerCase();
      if (!(await db.query("SELECT 1 FROM tokens WHERE address=$1", [token])).rowCount) return send(res, 404, { error: "unknown token" });
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
      const tokenResult = await db.query(`SELECT t.*,
          COALESCE((SELECT SUM(eth) FROM swaps s WHERE s.token=t.address AND s.ts>$1),0)::double precision AS vol24,
          COALESCE((SELECT price_eth FROM swaps WHERE token=t.address AND ts<=$1 ORDER BY ts DESC,id DESC LIMIT 1),
                   (SELECT price_eth FROM swaps WHERE token=t.address AND ts>=$1 ORDER BY ts ASC,id ASC LIMIT 1)) AS open24,
          (SELECT price_eth FROM swaps WHERE token=t.address AND ts>=$1 ORDER BY ts DESC,id DESC LIMIT 1) AS close24
        FROM tokens t WHERE t.address=$2`, [since, addr]);
      const r = tokenResult.rows[0];
      if (!r) return send(res, 404, { error: "unknown token" });
      const swapsResult = await db.query("SELECT ts, tx, eth, is_buy AS \"isBuy\", price_eth AS \"priceEth\" FROM swaps WHERE token=$1 ORDER BY ts DESC, id DESC LIMIT $2", [addr, Math.min(Math.max(Number(u.searchParams.get("swaps")) || 50, 1), 500)]);
      const swaps = swapsResult.rows.map((swap) => ({ ...swap, ts: Number(swap.ts) }));
      return send(res, 200, { token: shape(r), swaps });
    }
    const activityMatch = u.pathname.match(/^\/tokens\/(0x[0-9a-fA-F]{40})\/activity$/);
    if (activityMatch) {
      const addr = activityMatch[1].toLowerCase();
      const periodName = u.searchParams.get("period") || "1h";
      const periodSeconds = ACTIVITY_PERIODS[periodName];
      if (!periodSeconds) return send(res, 400, { error: "period must be one of 5m, 1h, 6h, 24h" });
      if (!(await db.query("SELECT 1 FROM tokens WHERE address=$1", [addr])).rowCount) return send(res, 404, { error: "unknown token" });
      const cutoff = Math.floor(Date.now() / 1000) - periodSeconds;
      const activityResult = await db.query(`SELECT COUNT(*) AS trades,
        COALESCE(SUM(eth),0)::double precision AS \"volumeEth\",
        SUM(CASE WHEN is_buy=1 THEN 1 ELSE 0 END) AS buys,
        SUM(CASE WHEN is_buy=0 THEN 1 ELSE 0 END) AS sells,
        COALESCE(SUM(CASE WHEN is_buy=1 THEN eth ELSE 0 END),0)::double precision AS "buyVolumeEth",
        COALESCE(SUM(CASE WHEN is_buy=0 THEN eth ELSE 0 END),0)::double precision AS "sellVolumeEth",
        COALESCE(
          (SELECT price_eth FROM swaps WHERE token=$1 AND ts<=$2 ORDER BY ts DESC,id DESC LIMIT 1),
          (SELECT price_eth FROM swaps WHERE token=$3 AND ts>=$4 ORDER BY ts ASC,id ASC LIMIT 1)
        ) AS "openPriceEth",
        (SELECT price_eth FROM swaps WHERE token=$5 AND ts>=$6 ORDER BY ts DESC,id DESC LIMIT 1) AS "closePriceEth"
        FROM swaps WHERE token=$7 AND ts>=$8`, [addr, cutoff, addr, cutoff, addr, cutoff, addr, cutoff]);
      const activity = activityResult.rows[0] as {
          trades: number; volumeEth: number; buys: number | null; sells: number | null;
          buyVolumeEth: number; sellVolumeEth: number; openPriceEth: number | null; closePriceEth: number | null;
        };
      const changePercent = activity.openPriceEth == null || activity.closePriceEth == null || activity.openPriceEth === 0
        ? null
        : ((activity.closePriceEth / activity.openPriceEth) - 1) * 100;
      return send(res, 200, { period: periodName, ...activity, trades: Number(activity.trades), buys: Number(activity.buys ?? 0), sells: Number(activity.sells ?? 0), changePercent });
    }
    const candleMatch = u.pathname.match(/^\/tokens\/(0x[0-9a-fA-F]{40})\/candles$/);
    if (candleMatch) {
      const addr = candleMatch[1].toLowerCase();
      const intervalName = u.searchParams.get("interval") || "1h";
      const interval = CANDLE_INTERVALS[intervalName];
      if (!interval) return send(res, 400, { error: "interval must be one of 1m, 5m, 15m, 1h, 4h, 1d" });
      const limit = Math.min(Math.max(Number(u.searchParams.get("limit")) || 200, 1), 500);
      if (!(await db.query("SELECT 1 FROM tokens WHERE address=$1", [addr])).rowCount) return send(res, 404, { error: "unknown token" });
      return send(res, 200, { interval: intervalName, candles: await buildCandles(addr, interval, limit) });
    }
    send(res, 404, { error: "not found" });
  } catch (e) {
    console.error(e);
    send(res, 500, { error: "server error" });
  }
});

async function start() {
  await initializeDatabase();
  server.listen(PORT, "0.0.0.0", () => console.log(`indexer API on :${PORT}`));
  for (;;) {
    try { await sync(); } catch (error) { console.error("sync error:", (error as Error).message); }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

void start().catch((error) => {
  console.error("indexer startup error:", (error as Error).message);
  process.exitCode = 1;
});
