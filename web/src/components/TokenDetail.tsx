import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Link } from "@/components/Link";
import { useQueries, useQuery } from "@tanstack/react-query";
import { fetchCandles, fetchEthUsd, fetchToken, fetchTokenActivity, fetchTokenHolders, fmtUsd, ago, resolveTokenImage } from "@/lib/api";
import { chain } from "@/lib/config";
import { SwapPanel } from "@/components/SwapPanel";
import { ManagePanel } from "@/components/ManagePanel";
import { TilesMarket } from "@/components/TilesMarket";

const web = (v: string) => (/^https?:\/\//.test(v) ? v : "");
const tokenHue = (address: string) => `${parseInt(address.slice(2, 8), 16) % 360}deg`;
function tokenAge(ts: number) {
  const seconds = Math.max(0, Math.floor(Date.now() / 1000) - ts);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 30 * 86400) return `${Math.floor(seconds / 86400)}d ago`;
  if (seconds < 365 * 86400) return `${Math.floor(seconds / (30 * 86400))}mo ago`;
  return `${Math.floor(seconds / (365 * 86400))}yr ago`;
}
const fmtCompactUsd = (value: number) => new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
}).format(value);
const chartPeriods = [
  { id: "5m", seconds: 300, candleInterval: "1m" },
  { id: "1h", seconds: 3600, candleInterval: "5m" },
  { id: "6h", seconds: 21600, candleInterval: "15m" },
  { id: "24h", seconds: 86400, candleInterval: "1h" },
] as const;
const TradingViewCandleChart = lazy(() => import("@/components/TradingViewCandleChart").then((module) => ({ default: module.TradingViewCandleChart })));

export function TokenDetail({ address, initialTab = "overview" }: { address: string; initialTab?: "overview" | "tiles" }) {
  const { data, error, isLoading } = useQuery({ queryKey: ["token", address], queryFn: () => fetchToken(address), refetchInterval: 5000, retry: false });
  const [period, setPeriod] = useState<(typeof chartPeriods)[number]["id"]>("24h");
  const [activityTab, setActivityTab] = useState<"trades" | "holders">("trades");
  const [activeTab, setActiveTab] = useState<"overview" | "tiles">(initialTab);
  const [tokenAddressCopied, setTokenAddressCopied] = useState(false);
  const [mobileSwapOpen, setMobileSwapOpen] = useState(false);
  const [mobileSwapDirection, setMobileSwapDirection] = useState<"buy" | "sell">("buy");
  const mobileSwapDialog = useRef<HTMLDialogElement>(null);
  const periodIndex = chartPeriods.findIndex((item) => item.id === period);
  const activityQueries = useQueries({
    queries: chartPeriods.map((item) => ({
      queryKey: ["token-activity", address, item.id],
      queryFn: () => fetchTokenActivity(address, item.id),
      refetchInterval: 15_000,
      retry: false,
    })),
  });
  const activity = activityQueries[periodIndex]?.data;
  const candles = useQuery({
    queryKey: ["token-candles", address, period],
    queryFn: () => fetchCandles(address, chartPeriods[periodIndex].candleInterval),
    refetchInterval: 15_000,
    retry: false,
  });
  const ethUsd = useQuery({ queryKey: ["eth-usd-reference"], queryFn: fetchEthUsd, refetchInterval: 60_000, staleTime: 30_000, retry: false });
  const holders = useQuery({ queryKey: ["token-holders", address], queryFn: () => fetchTokenHolders(address), refetchInterval: 60_000, retry: false });
  const explorer = chain.blockExplorers?.default.url;

  useEffect(() => {
    const dialog = mobileSwapDialog.current;
    if (!dialog) return;
    if (mobileSwapOpen && !dialog.open) dialog.showModal();
    if (!mobileSwapOpen && dialog.open) dialog.close();
  }, [mobileSwapOpen]);

  if (isLoading) return <p className="note">Loading token…</p>;
  if (error || !data) return <p className="note bad">{(error as Error)?.message || "Token unavailable."} <Link href="/">Back to tokens</Link></p>;

  const { token: t, swaps } = data;
  const site = web(t.website), tw = web(t.twitter), tg = web(t.telegram);
  const stats = [
    { id: "volume", label: "24h volume", value: ethUsd.data ? fmtUsd(t.volume24hEth * ethUsd.data) : "—" },
    { id: "supply", label: "Total supply", value: "1B" },
    { id: "holders", label: "Holders", value: holders.data?.toLocaleString() ?? "—" },
    { id: "fee", label: "Trading fee", value: `${t.feePercent}%` },
  ];
  const change24h = activityQueries[3]?.data?.changePercent;
  const changeLabel = change24h == null ? "0.0%" : `${change24h >= 0 ? "+" : ""}${change24h.toFixed(1)}%`;
  const cutoff = Date.now() / 1000 - chartPeriods[periodIndex].seconds;
  const periodCandles = (candles.data ?? []).filter((candle) => candle.time >= cutoff);
  async function copyTokenAddress() {
    try {
      await navigator.clipboard.writeText(t.address);
      setTokenAddressCopied(true);
      window.setTimeout(() => setTokenAddressCopied(false), 1800);
    } catch {
      setTokenAddressCopied(false);
    }
  }
  const socialLinks = <>
    {site && <a href={site} target="_blank" rel="noopener noreferrer" aria-label="Website" title="Website"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/></svg></a>}
    {tw && <a href={tw} target="_blank" rel="noopener noreferrer" aria-label="X" title="X"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18.9 2H22l-6.8 7.8L23.2 22h-6.3L12 14.6 5.5 22H2.3l7.3-8.4L1.8 2h6.5l4.5 6.8L18.9 2Zm-1.1 18h1.7L7.3 3.9H5.5L17.8 20Z"/></svg></a>}
    {tg && <a href={tg} target="_blank" rel="noopener noreferrer" aria-label="Telegram" title="Telegram"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m21.6 3.4-3.3 16c-.2 1.1-.9 1.4-1.8.9l-5-3.7-2.4 2.3c-.3.3-.5.5-1 .5l.4-5.1 9.3-8.4c.4-.4-.1-.6-.6-.2L5.7 17l-5-1.6c-1.1-.3-1.1-1.1.2-1.6L20.4 2.1c.9-.3 1.6.2 1.2 1.3Z"/></svg></a>}
  </>;
  return (
    <section className="token-page">
      {/*<div className="token-page-topline"><Link href="/">← All tokens</Link><span>Token markets <b> / </b> {t.symbol}</span></div>*/}
      <header className="token-hero" id="token-overview" style={{ marginBottom: "0px", "--token-hue": tokenHue(t.address) } as React.CSSProperties}>
        <div className="token-hero-art-stage">
          {t.image ? <img className="token-hero-art" src={resolveTokenImage(t.image)} alt={`${t.symbol} token artwork`} referrerPolicy="no-referrer" onError={(e) => (e.currentTarget.style.visibility = "hidden")} /> : <div className="token-hero-art token-hero-placeholder">{t.symbol.slice(0, 1)}</div>}
        </div>
        <div className="token-hero-identity"><p className="token-hero-kicker">TOKEN OVERVIEW <span>·</span> {tokenAge(t.createdAt).toUpperCase()}</p><h1>{t.name}</h1><div className="token-hero-symbol"><span>${t.symbol}</span><button className="token-address-inline-copy" type="button" onClick={() => void copyTokenAddress()} aria-label={tokenAddressCopied ? "Token address copied" : "Copy token address"}>{tokenAddressCopied ? "✓" : <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="5" y="5" width="9" height="10" rx="1.5"/><path d="M11 5V3.5A1.5 1.5 0 0 0 9.5 2h-6A1.5 1.5 0 0 0 2 3.5v7A1.5 1.5 0 0 0 3.5 12H5"/></svg>}</button><div className="token-hero-socials token-hero-socials-mobile" role="group" aria-label="Token social links">{socialLinks}</div></div></div>
        <div className="token-hero-data">
          <div className="token-hero-market-cap"><span>MARKET CAP</span><strong>{ethUsd.data && t.marketCapEth != null ? fmtCompactUsd(t.marketCapEth * ethUsd.data) : "—"}</strong><small className={change24h != null && change24h < 0 ? "change-negative" : "change-positive"}>{changeLabel} <span>24H</span></small></div>
          <div className="token-hero-metrics" aria-label="Token metrics">
            <div><span>PRICE</span><b>{ethUsd.data && t.priceEth != null ? fmtUsd(t.priceEth * ethUsd.data) : "—"}</b></div>
            <div><span>TOTAL SUPPLY</span><b>1B</b></div>
            <div><span>24H VOLUME</span><b>{ethUsd.data ? fmtUsd(t.volume24hEth * ethUsd.data) : "—"}</b></div>
            <div><span>HOLDERS</span><b>{holders.data?.toLocaleString() ?? "—"}</b></div>
          </div>
        </div>
        <nav className="token-hero-socials token-hero-socials-desktop" aria-label="Token social links">{socialLinks}</nav>
        {explorer && <a className="token-share-link" href={`${explorer}/address/${t.address}`} target="_blank" rel="noopener noreferrer" aria-label="View token contract" title="View contract">↗</a>}
        <div className="token-hero-watermark" aria-hidden="true">{t.symbol.slice(0, 1).toUpperCase()}</div>
      </header>
      <nav className="token-feature-nav" aria-label="Token features" role="tablist" style={{ "--token-hue": tokenHue(t.address) } as React.CSSProperties}>
        <button type="button" role="tab" aria-selected={activeTab === "overview"} className={activeTab === "overview" ? "is-current" : ""} onClick={() => setActiveTab("overview")}>Overview</button>
        <button type="button" role="tab" aria-selected={activeTab === "tiles"} className={activeTab === "tiles" ? "is-current" : ""} onClick={() => setActiveTab("tiles")}>Tiles <span>100</span></button>
      </nav>
      {/*<nav className="token-mobile-tabs" aria-label="Token sections"><a href="#token-trade">Trade</a><a href="#token-info">Info</a><a href="#token-activity">Activity</a><a href="#token-earnings">Earnings</a></nav>*/}

      {activeTab === "tiles" ? <TilesMarket token={t} /> : <div className="token-page-grid">
        <main className="token-main-column">
          <div className="panel token-chart-panel" id="token-chart">
            <div className="token-chart-top">
              {/*<div className="token-chart-heading">
                <span className="eyebrow">Price chart</span>
                <span className="chart-market-status"><i aria-hidden="true" />Market activity</span>
              </div>*/}
              <div className="candle-intervals" role="group" aria-label="Chart timeframe">{chartPeriods.map((item, index) => { const change = activityQueries[index]?.data?.changePercent; return <button key={item.id} aria-pressed={period === item.id} onClick={() => setPeriod(item.id)}>{item.id}<span className={change == null ? "" : change >= 0 ? "change-positive" : "change-negative"}>{change == null ? "" : `${change >= 0 ? "+" : ""}${change.toFixed(1)}%`}</span></button>; })}</div>
            </div>
            {/*activity && ethUsd.data && <div className="chart-activity-summary" aria-label={`${period} activity summary`}><div><span>Volume</span><b>{fmtUsd(activity.volumeEth * ethUsd.data)}</b></div><div><span>Trades</span><b>{activity.trades.toLocaleString()}</b></div><div><span>Buys / sells</span><b><i>{activity.buys.toLocaleString()}</i> / <em>{activity.sells.toLocaleString()}</em></b></div><div><span>Net buy volume</span><b className={activity.buyVolumeEth >= activity.sellVolumeEth ? "ok" : "bad"}>{fmtUsd((activity.buyVolumeEth - activity.sellVolumeEth) * ethUsd.data)}</b></div></div>*/}
            {candles.error ? <p className="note bad">{(candles.error as Error).message}</p> : candles.isLoading ? <div className="chart-loading">Loading candles…</div> : !ethUsd.data ? <p className="note">USD candle prices are unavailable until the ETH/USD reference loads.</p> : periodCandles.length ? <Suspense fallback={<div className="chart-loading">Loading chart…</div>}><TradingViewCandleChart candles={periodCandles} usdRate={ethUsd.data} /></Suspense> : <div className="empty-trades">No candles for this period yet.</div>}
          </div>

          <section className="panel token-info-card" id="token-info">
            <h2>Project info</h2>
            <div className="token-description"><span>About {t.name}</span><p>{t.description || "..."}</p></div>
          </section>

          <section className="panel token-activity-card" id="token-activity" style={{ "--token-hue": tokenHue(t.address) } as React.CSSProperties}>
            <div className="token-activity-heading">
              <div className="token-activity-tabs" role="tablist" aria-label="Token activity">
                <button id="activity-trades-tab" type="button" role="tab" aria-selected={activityTab === "trades"} aria-controls="activity-table-panel" onClick={() => setActivityTab("trades")}>Trade <span>{swaps.length}</span></button>
                <button id="activity-holders-tab" type="button" role="tab" aria-selected={activityTab === "holders"} aria-controls="activity-table-panel" onClick={() => setActivityTab("holders")}>Holder <span>{holders.data?.toLocaleString() ?? "—"}</span></button>
              </div>
              {activityTab === "trades" && <span className="token-activity-live"><i className="activity-live-dot" aria-hidden="true" />Live</span>}
            </div>
            <div id="activity-table-panel" role="tabpanel" aria-labelledby={activityTab === "trades" ? "activity-trades-tab" : "activity-holders-tab"} className="token-activity-table-wrap">
              {activityTab === "trades" ? swaps.length === 0 ? <p className="empty-trades">No trades yet. Activity will appear after the first swap.</p> : (
                <table className="token-activity-table"><thead><tr><th>Time</th><th>Type</th><th>Amount</th><th>Trader</th><th>Transaction</th></tr></thead><tbody>
                  {swaps.slice(0, 30).map((s, i) => <tr key={`${s.tx}-${i}`}>
                    <td><time>{ago(s.ts)}</time></td>
                    <td><span className={`activity-trade-type ${s.isBuy ? "buy" : "sell"}`}>{s.isBuy ? "Buy" : "Sell"}</span></td>
                    <td>{ethUsd.data ? fmtUsd(s.eth * ethUsd.data) : `${s.eth.toFixed(4)} ETH`}</td>
                    <td className="token-activity-trader">—</td>
                    <td>{explorer ? <a href={`${explorer}/tx/${s.tx}`} target="_blank" rel="noopener noreferrer">{s.tx.slice(0, 6)}…{s.tx.slice(-4)} ↗</a> : <span>{s.tx.slice(0, 6)}…{s.tx.slice(-4)}</span>}</td>
                  </tr>)}
                </tbody></table>
              ) : <div className="token-holder-summary"><span>Tracked holders</span><b>{holders.data?.toLocaleString() ?? "—"}</b><small>Holder count from the token indexer. Wallet-level holder details are not currently available.</small></div>}
            </div>
          </section>

          {/*<section className="panel token-info-card" id="token-info"><h2>Project info</h2><div className="token-people"><div><span>Launched by</span><b className="token-person-avatar">{t.creator.slice(2, 4).toUpperCase()}</b><a href={explorer ? `${explorer}/address/${t.creator}` : undefined} target="_blank" rel="noopener noreferrer">{t.creator.slice(0, 6)}…{t.creator.slice(-4)}</a></div><div><span>Token contract</span><b className="token-person-avatar token-contract-avatar">{t.symbol.slice(0, 1)}</b><a href={explorer ? `${explorer}/address/${t.address}` : undefined} target="_blank" rel="noopener noreferrer">{t.address.slice(0, 6)}…{t.address.slice(-4)}</a></div></div>
            <div className="token-description"><span>About</span><p>{t.description || "No project description has been added yet."}</p></div>
            {(site || tw || tg) && <div className="token-info-socials"><span>Socials</span><div>{site && <a href={site} target="_blank" rel="noopener noreferrer">Website ↗</a>}{tw && <a href={tw} target="_blank" rel="noopener noreferrer">X ↗</a>}{tg && <a href={tg} target="_blank" rel="noopener noreferrer">Telegram ↗</a>}</div></div>}
            <div className="token-info-stats"><h3>Token info</h3>{stats.map((item) => <div key={item.id}><span>{item.label}</span><b>{item.value}</b></div>)}</div><p className="token-unverified-note">Token details are supplied by the creator and are unverified.</p>
          </section>*/}
          <ManagePanel token={t.address} />
        </main>

        <aside className="token-side-column">
          <div id="token-trade" className="token-trade-card"><SwapPanel token={t.address} tokenSymbol={t.symbol} poolFee={t.fee} poolHook={t.hook} /></div>
        </aside>
      </div>}

      <div className="token-mobile-trade-bar" style={{ "--token-hue": tokenHue(t.address) } as React.CSSProperties}>
        <button type="button" onClick={() => { setMobileSwapDirection("buy"); setMobileSwapOpen(true); }}>Buy {t.symbol}</button>
        <button type="button" onClick={() => { setMobileSwapDirection("sell"); setMobileSwapOpen(true); }}>Sell {t.symbol}</button>
      </div>

      <dialog
        ref={mobileSwapDialog}
        className="token-mobile-swap-dialog"
        style={{ "--token-hue": tokenHue(t.address) } as React.CSSProperties}
        onClose={() => setMobileSwapOpen(false)}
        onClick={(event) => { if (event.target === mobileSwapDialog.current) setMobileSwapOpen(false); }}
      >
        <div className="token-mobile-swap-dialog-header">
          <span>Trade {t.symbol}</span>
          <button type="button" aria-label="Close swap" onClick={() => setMobileSwapOpen(false)} autoFocus>×</button>
        </div>
        {mobileSwapOpen && <div className="token-trade-card mobile-swap-dialog-card"><SwapPanel token={t.address} tokenSymbol={t.symbol} poolFee={t.fee} poolHook={t.hook} initialDirection={mobileSwapDirection} /></div>}
      </dialog>
    </section>
  );
}
