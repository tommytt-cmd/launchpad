"use client";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { fetchCandles, fetchEthUsd, fetchToken, fetchTokenActivity, fetchTokenHolders, fmtUsd, ago, resolveTokenImage } from "@/lib/api";
import { chain } from "@/lib/config";
import { SwapPanel } from "@/components/SwapPanel";
import { ManagePanel } from "@/components/ManagePanel";
import { useAccount } from "wagmi";

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
const TradingViewCandleChart = dynamic(() => import("@/components/TradingViewCandleChart").then((module) => module.TradingViewCandleChart), {
  ssr: false,
  loading: () => <div className="chart-loading">Loading chart…</div>,
});

export function TokenDetail({ address }: { address: string }) {
  const { data, error, isLoading } = useQuery({ queryKey: ["token", address], queryFn: () => fetchToken(address), refetchInterval: 5000, retry: false });
  const [period, setPeriod] = useState<(typeof chartPeriods)[number]["id"]>("24h");
  const [tokenAddressCopied, setTokenAddressCopied] = useState(false);
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
  const { address: connectedAddress } = useAccount();
  const explorer = chain.blockExplorers?.default.url;

  if (isLoading) return <p className="note">Loading token…</p>;
  if (error || !data) return <p className="note bad">{(error as Error)?.message || "Token unavailable."} <Link href="/">Back to tokens</Link></p>;

  const { token: t, swaps } = data;
  const site = web(t.website), tw = web(t.twitter), tg = web(t.telegram);
  const stats = [
    { id: "market-cap", label: "Market cap", value: ethUsd.data && t.marketCapEth != null ? fmtCompactUsd(t.marketCapEth * ethUsd.data) : "—" },
    /* { id: "price", label: "Price", value: ethUsd.data && t.priceEth != null ? fmtUsd(t.priceEth * ethUsd.data) : "—" }, */
    { id: "volume", label: "24h volume", value: ethUsd.data ? fmtUsd(t.volume24hEth * ethUsd.data) : "—" },
    { id: "supply", label: "Supply", value: "1B" },
    { id: "holders", label: "Holders", value: holders.data?.toLocaleString() ?? "—" },
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
  return (
    <section>
      <p className="note"><Link href="/">← All tokens</Link></p>
      {/*<p className="usd-reference">USD reference uses ETH spot pricing; Robinhood testnet ETH has no redeemable dollar value.{ethUsd.error ? " Spot price unavailable." : ""}</p>*/}

      <div className="token-terminal-grid">
        <SwapPanel token={t.address} tokenSymbol={t.symbol} poolFee={t.fee} poolHook={t.hook} />
        <div className="token-chart-area">
          <div className="thead">
            {t.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={resolveTokenImage(t.image)} alt={`${t.symbol} token artwork`} width={72} height={90} referrerPolicy="no-referrer" onError={(e) => (e.currentTarget.style.visibility = "hidden")} />
            ) : (
              <div className="avatar big" style={{ "--token-hue": tokenHue(t.address) } as React.CSSProperties} aria-hidden>{t.symbol.slice(0, 1)}</div>
            )}
            <div>
              <h2>{t.name} <span className="pill">{t.symbol}</span></h2>
              <h3 className="" style={{ margin: "4px 0 0",  }}>{ethUsd.data && t.priceEth != null ? fmtUsd(t.priceEth * ethUsd.data) : "—"}</h3>
              <p className="note token-detail-meta">
                <span className="token-age"><svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.25"/><path d="M8 4.5V8l2.3 1.4"/></svg>{tokenAge(t.createdAt)}</span>
                <span>Fee {t.feePercent}%</span>
                <span className="token-address-meta">{explorer ? <a href={`${explorer}/address/${t.address}`} target="_blank" rel="noopener">{t.address.slice(0, 6)}…{t.address.slice(-4)}</a> : `${t.address.slice(0, 6)}…${t.address.slice(-4)}`}<button className="token-address-inline-copy" type="button" onClick={() => void copyTokenAddress()} aria-label={tokenAddressCopied ? "Token address copied" : "Copy token address"} title={tokenAddressCopied ? "Copied" : "Copy token address"}>{tokenAddressCopied ? "✓" : <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="5" y="5" width="9" height="10" rx="1.5"/><path d="M11 5V3.5A1.5 1.5 0 0 0 9.5 2h-6A1.5 1.5 0 0 0 2 3.5v7A1.5 1.5 0 0 0 3.5 12H5"/></svg>}</button></span>
              </p>
              {(explorer || site || tw || tg) && <nav className="token-social-links" aria-label="Token links">
                {explorer && <a className="token-social-link" href={`${explorer}/address/${t.address}`} target="_blank" rel="noopener noreferrer" aria-label="View token on block explorer"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9"/><path d="M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5"/></svg></a>}
                {site && <a className="token-social-link" href={site} target="_blank" rel="noopener nofollow" aria-label="Website"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/></svg></a>}
                {tw && <a className="token-social-link" href={tw} target="_blank" rel="noopener nofollow" aria-label="X"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18.9 2H22l-6.8 7.8L23.2 22h-6.3l-4.9-7.4L5.5 22H2.4l7.3-8.4L1.9 2h6.5l4.4 6.8L18.9 2Zm-1.1 18h1.7L7.4 3.9H5.6L17.8 20Z"/></svg></a>}
                {tg && <a className="token-social-link" href={tg} target="_blank" rel="noopener nofollow" aria-label="Telegram"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21.6 4.2 18.3 20c-.2 1.1-.9 1.3-1.8.8l-5-3.7-2.4 2.3c-.3.3-.5.5-1 .5l.4-5.1 9.3-8.4c.4-.4-.1-.6-.6-.2L5.7 13.4.8 11.9c-1.1-.3-1.1-1 .2-1.5L20.2 3c.9-.3 1.7.2 1.4 1.2Z"/></svg></a>}
              </nav>}
            </div>
          </div>

          <div className="tstats token-stats-selected token-stats-strip" aria-label="Token market statistics">
            {stats.map((item) => <div className="panel" key={item.id}><span>{item.label}</span><b>{item.value}</b></div>)}
          </div>

          <div className="panel token-chart-panel">
            <div className="token-panel-heading">
              <div><p className="eyebrow">Market activity</p></div>
              <div className="candle-intervals" role="group" aria-label="Chart timeframe">
                {chartPeriods.map((item, index) => {
                  const change = activityQueries[index]?.data?.changePercent;
                  return <button key={item.id} aria-pressed={period === item.id} onClick={() => setPeriod(item.id)}>{item.id}<span className={change == null ? "" : change >= 0 ? "change-positive" : "change-negative"}>{change == null ? "—" : `${change >= 0 ? "+" : ""}${change.toFixed(1)}%`}</span></button>;
                })}
              </div>
            </div>
            {activity && ethUsd.data && <div className="chart-activity-summary" aria-label={`${period} activity summary`}>
              <div><span>Volume</span><b>{fmtUsd(activity.volumeEth * ethUsd.data)}</b></div>
              <div><span>Transactions</span><b>{activity.trades.toLocaleString()}</b></div>
              <div><span>Buys / sells</span><b><i>{activity.buys.toLocaleString()}</i> / <em>{activity.sells.toLocaleString()}</em></b></div>
              <div><span>Net buy volume</span><b className={activity.buyVolumeEth >= activity.sellVolumeEth ? "ok" : "bad"}>{fmtUsd((activity.buyVolumeEth - activity.sellVolumeEth) * ethUsd.data)}</b></div>
            </div>}
            {candles.error ? <p className="note bad">{(candles.error as Error).message}</p> : candles.isLoading ? <div className="chart-loading">Loading candles…</div> : !ethUsd.data ? <p className="note">USD candle prices are unavailable until the ETH/USD reference loads.</p> : periodCandles.length ? <TradingViewCandleChart candles={periodCandles} usdRate={ethUsd.data} /> : <div className="empty-trades">No candles for this period yet.</div>}
          </div>

          <div className="panel recent-trades">
            <div className="token-panel-heading">
              <div><p className="eyebrow">Onchain tape</p><h3>Recent trades</h3></div>
              <span className="trade-count">Latest {Math.min(swaps.length, 30)}</span>
            </div>
            {swaps.length === 0 ? <p className="empty-trades">No trades yet. The first swap starts this market&apos;s history.</p> : (
              <div className="tablewrap">
                <table>
                  <thead><tr><th>Time</th><th>Side</th><th>Value (USD)</th><th>Price (USD)</th><th>Tx</th></tr></thead>
                  <tbody>
                    {swaps.slice(0, 30).map((s, i) => (
                      <tr key={s.tx + i}>
                        <td>{ago(s.ts)}</td>
                        <td className={s.isBuy ? "ok" : "bad"}>{s.isBuy ? "Buy" : "Sell"}</td>
                        <td>{ethUsd.data ? fmtUsd(s.eth * ethUsd.data) : "—"}</td>
                        <td>{ethUsd.data ? fmtUsd(s.priceEth * ethUsd.data) : "—"}</td>
                        <td>{explorer ? <a href={`${explorer}/tx/${s.tx}`} target="_blank" rel="noopener">{s.tx.slice(0, 8)}…</a> : s.tx.slice(0, 8) + "…"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="actions">
        {explorer && <a className="btnlink" href={`${explorer}/address/${t.address}`} target="_blank" rel="noopener">View contract</a>}
      </div>
      <p className="note">Token details are supplied by the creator and are unverified.</p>
      {connectedAddress?.toLowerCase() === t.creator.toLowerCase() && <ManagePanel token={t.address} />}
    </section>
  );
}
