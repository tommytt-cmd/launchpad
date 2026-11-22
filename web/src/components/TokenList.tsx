import { useEffect, useRef, useState } from "react";
import { Link } from "@/components/Link";
import { useQuery } from "@tanstack/react-query";
import { fetchEthUsd, fetchMarketStats, fetchTokens, fmtUsd, ago, resolveTokenImage } from "@/lib/api";

const tokenHue = (address: string) => `${parseInt(address.slice(2, 8), 16) % 360}deg`;
const tokenStyle = (address: string) => ({ "--token-hue": tokenHue(address) } as React.CSSProperties);
const fmtCompactUsd = (value: number) => new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
}).format(value);

function TokenArtwork({ token, featured = false }: { token: { address: string; symbol: string; image: string }; featured?: boolean }) {
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => setImageFailed(false), [token.address, token.image]);

  if (token.image && !imageFailed) {
    return <img className={featured ? "token-art featured-art" : "token-art"} src={resolveTokenImage(token.image)} alt={`${token.symbol} token artwork`} loading="lazy" referrerPolicy="no-referrer" onError={() => setImageFailed(true)} />;
  }
  const motif = parseInt(token.address.slice(8, 10), 16) % 3;
  return <div className={`token-art token-sigil motif-${motif}${featured ? " featured-art" : ""}`} style={tokenStyle(token.address)} aria-hidden="true"><span>{token.symbol.slice(0, 1)}</span><i /><b /></div>;
}

function TopLaunches({ ethUsd }: { ethUsd?: number }) {
  const [copiedAddress, setCopiedAddress] = useState<string | null>(null);
  const { data: volumeTokens = [] } = useQuery({
    queryKey: ["top-launches"],
    queryFn: () => fetchTokens("volume", ""),
    refetchInterval: 5000,
  });
  const tokens = volumeTokens.slice(0, 5);
  async function copyTokenAddress(address: string) {
    try {
      await navigator.clipboard.writeText(address);
      setCopiedAddress(address);
      window.setTimeout(() => setCopiedAddress((current) => current === address ? null : current), 1800);
    } catch {
      setCopiedAddress(null);
    }
  }

  if (tokens.length === 0) return null;

  return (
    <section className="top-launches" aria-label="Top launches">
      <div className="top-launches-heading">
        <div>{/*<p className="eyebrow">MARKET BOARD</p><*/}<h3>Top launches</h3></div>
        <Link className="launch-link" href="/launch"><span aria-hidden>＋</span> Launch token</Link>
      </div>
      <div className="top-launches-viewport" aria-label="Top tokens by 24-hour volume">
        <div className="top-launches-track" aria-live="off">
          {[0, 1].map((copy) => (
            <div className="top-launches-group" key={copy} aria-hidden={copy === 1}>
              {tokens.map((token, index) => (
                <article className="featured-token top-launch-card" key={token.address} style={tokenStyle(token.address)}>
                  <div className="featured-art-stage"><TokenArtwork token={token} featured /></div>
                  <div className="featured-copy">
                    {/*I<p className="featured-rank">{String(index + 1).padStart(2, "0")} <span>/ MARKET BOARD</span></p>*/}
                    <div className="top-launch-title-row"><h3>{token.name} <span>{token.symbol}</span></h3><button className="token-address-copy" type="button" onClick={() => void copyTokenAddress(token.address)} tabIndex={copy === 1 ? -1 : undefined} aria-label={copiedAddress === token.address ? "Token address copied" : `Copy ${token.name} token address`} title={copiedAddress === token.address ? "Copied" : "Copy address"}>{copiedAddress === token.address ? "✓" : <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="5" y="5" width="9" height="10" rx="1.5"/><path d="M11 5V3.5A1.5 1.5 0 0 0 9.5 2h-6A1.5 1.5 0 0 0 2 3.5v7A1.5 1.5 0 0 0 3.5 12H5"/></svg>}</button></div>
                    {/*token.description && <p className="featured-description">{token.description}</p>*/}
                    <div className="featured-stats">
                      <div><span>MARKET CAP</span><b>{ethUsd && token.marketCapEth != null ? fmtCompactUsd(token.marketCapEth * ethUsd) : "—"}</b></div>
                      <div><span>24H CHANGE</span><b className={token.change24hPercent == null || token.change24hPercent >= 0 ? "change-positive" : "change-negative"}>{token.change24hPercent == null || token.change24hPercent === 0 ? "0.0%" : `${token.change24hPercent > 0 ? "+" : ""}${token.change24hPercent.toFixed(1)}%`}</b></div>
                    </div>
                  </div>
                  {/*<Link className="featured-cta" href={`/token/${token.address}`} tabIndex={copy === 1 ? -1 : undefined} aria-label={`Open ${token.name} market`}><span>Open market</span><b aria-hidden="true">↗</b></Link>*/}
                  <Link className="top-launch-card-link" href={`/token/${token.address}`} tabIndex={copy === 1 ? -1 : undefined} aria-label={`Open ${token.name} market`} />
                  <div className="featured-watermark" aria-hidden="true">{token.symbol.slice(0, 1)}</div>
                </article>
              ))}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function NewLaunchToast() {
  const [toastToken, setToastToken] = useState<Awaited<ReturnType<typeof fetchTokens>>[number] | null>(null);
  const lastSeenAddress = useRef<string | null>(null);
  const { data: latestTokens } = useQuery({
    queryKey: ["homepage-latest-launches"],
    queryFn: () => fetchTokens("new", ""),
    refetchInterval: 5000,
  });
  const latest = latestTokens?.[0];

  useEffect(() => {
    if (!latest) return;
    const address = latest.address.toLowerCase();
    if (lastSeenAddress.current === address) return;

    const isFirstCheck = lastSeenAddress.current === null;
    lastSeenAddress.current = address;
    const ageSeconds = Math.max(0, Date.now() / 1000 - latest.createdAt);
    if (!isFirstCheck || ageSeconds <= 60) setToastToken(latest);
  }, [latest]);

  useEffect(() => {
    if (!toastToken) return;
    const timeout = window.setTimeout(() => setToastToken(null), 7000);
    return () => window.clearTimeout(timeout);
  }, [toastToken]);

  if (!toastToken) return null;

  return (
    <aside className="launch-toast" role="status" aria-live="polite" aria-label="New token launch">
      <div className="launch-toast-art" style={tokenStyle(toastToken.address)}>
        <TokenArtwork token={toastToken} />
      </div>
      <div className="launch-toast-copy">
        <span>NEW LAUNCH</span>
        <b>{toastToken.name}</b>
        <small>${toastToken.symbol}</small>
      </div>
      <Link href={`/token/${toastToken.address}`}>Trade <span aria-hidden="true">↗</span></Link>
      <button type="button" aria-label="Dismiss new launch notification" onClick={() => setToastToken(null)}>×</button>
    </aside>
  );
}

export function TokenList() {
  const [sort, setSort] = useState("new");
  const [q, setQ] = useState("");
  const [copiedAddress, setCopiedAddress] = useState<string | null>(null);
  const { data, error, isLoading } = useQuery({
    queryKey: ["tokens", sort, q],
    queryFn: () => fetchTokens(sort, q),
    refetchInterval: 5000,
  });
  const market = useQuery({ queryKey: ["market-stats"], queryFn: fetchMarketStats, refetchInterval: 10_000, retry: false });
  const ethUsd = useQuery({ queryKey: ["eth-usd-reference"], queryFn: fetchEthUsd, refetchInterval: 60_000, staleTime: 30_000, retry: false });
  const rankedTokens = data ?? [];

  async function copyTokenAddress(address: string) {
    try {
      await navigator.clipboard.writeText(address);
      setCopiedAddress(address);
      window.setTimeout(() => setCopiedAddress((current) => current === address ? null : current), 1800);
    } catch {
      setCopiedAddress(null);
    }
  }

  return (
    <section>
      <NewLaunchToast />
      {/*<div className="market-heading">
        <div>
          {/*<p className="eyebrow"><span className="live-dot" /> Robinhood testnet · live markets</p>/}
          <h2>Token markets</h2>
        </div>
        <Link className="launch-link" href="/launch"><span aria-hidden>＋</span> Launch token</Link>
      </div>
      <div className="market-overview" aria-label="Market overview">
        <article className="market-stat-card market-stat-live">
          <div className="market-stat-art-stage" aria-hidden="true"><span>T</span></div>
          <div className="market-stat-copy"><span className="market-stat-label"><i aria-hidden="true" />Tokens live</span><b>{market.data?.tokens ?? "—"}</b></div>
        </article>
        <article className="market-stat-card market-stat-volume">
          <div className="market-stat-art-stage" aria-hidden="true"><span>$</span></div>
          <div className="market-stat-copy"><span className="market-stat-label">24h volume</span><b>{market.data && ethUsd.data ? fmtCompactUsd(market.data.volume24hEth * ethUsd.data) : "—"}</b></div>
        </article>
        <article className="market-stat-card market-stat-trades">
          <div className="market-stat-art-stage" aria-hidden="true"><span>⇄</span></div>
          <div className="market-stat-copy"><span className="market-stat-label">24h trades</span><b>{market.data?.trades24h ?? "—"}</b></div>
        </article>
      </div>*/}
      {market.error && <p className="market-stats-error">Market-wide activity summary is temporarily unavailable.</p>}
      <TopLaunches ethUsd={ethUsd.data} />
      <div className="toolbar">
        <label className="search-field"><span aria-hidden>⌕</span><input aria-label="Search" placeholder="Search token, ticker or address" value={q} onChange={(e) => setQ(e.target.value)} /></label>
        <div className="sort-field" role="group" aria-label="Sort tokens">
          <button aria-pressed={sort === "new"} onClick={() => setSort("new")}>New</button>
          <button aria-pressed={sort === "volume"} onClick={() => setSort("volume")}>Volume</button>
          <button aria-pressed={sort === "mcap"} onClick={() => setSort("mcap")}>Cap</button>
        </div>
      </div>
      {/*<div className="discover-section-heading"><h3>{sort === "new" ? "Latest launches" : sort === "volume" ? "Most active" : "Largest markets"}</h3><span>{data ? `${data.length} tokens` : "Syncing market…"}</span></div>*/}
      {error && <div className="market-empty error-state"><b>Market data unavailable</b><span>{(error as Error).message} Check VITE_INDEXER_URL.</span></div>}
      {data && data.length === 0 && <div className="market-empty"><b>{q ? "No matching tokens" : "No tokens launched yet"}</b><span>{q ? "Try another name, ticker, or address." : "Launch the first token to open this market."}</span>{!q && <Link className="launch-link" href="/launch">Launch token <span aria-hidden>↗</span></Link>}</div>}
      <div className="token-card-grid">
        {isLoading && <div className="token-card-skeletons" aria-label="Loading token markets">{[0, 1, 2, 3, 4, 5].map((item) => <div className="token-card-skeleton" key={item}><i /><span /><b /><b /><b /></div>)}</div>}
        {rankedTokens.map((t) => (
          <Link className="token-market-card" href={`/token/${t.address}`} key={t.address} style={tokenStyle(t.address)}>
            <div className={`token-art-stage${t.image ? " token-art-stage-image" : ""}`}><TokenArtwork token={t} /></div>
            <div>

              <div className="token-card-identity">
                <div className="token-title-line"><Link href={`/token/${t.address}`}><b>{t.name}</b></Link> <span className="pill">{t.symbol}</span><button className="token-address-copy" type="button" onClick={() => void copyTokenAddress(t.address)} aria-label={copiedAddress === t.address ? "Token address copied" : `Copy ${t.name} token address`} title={copiedAddress === t.address ? "Copied" : "Copy address"}>{copiedAddress === t.address ? "✓" : <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="5" y="5" width="9" height="10" rx="1.5"/><path d="M11 5V3.5A1.5 1.5 0 0 0 9.5 2h-6A1.5 1.5 0 0 0 2 3.5v7A1.5 1.5 0 0 0 3.5 12H5"/></svg>}</button></div>
                {/*<div className="token-activity"><span>{ago(t.createdAt)}</span><span className="activity-track"><i style={{ width: `${maxVolume > 0 ? Math.max(4, (t.volume24hEth / maxVolume) * 100) : 0}%` }} /></span><span>VOL</span></div>*/}
              </div>
              {/*<dl className="token-card-metrics">
                <div aria-label="Market cap"><dt className="sr-only">Market cap</dt><dd>{ethUsd.data && t.marketCapEth != null ? fmtCompactUsd(t.marketCapEth * ethUsd.data) : "—"}</dd></div>
                <div aria-label="24-hour change"><dt className="sr-only">24-hour change</dt><dd className={t.change24hPercent == null || t.change24hPercent >= 0 ? "change-positive" : "change-negative"}>{t.change24hPercent == null || t.change24hPercent === 0 ? "0.0%" : `${t.change24hPercent > 0 ? "+" : ""}${t.change24hPercent.toFixed(1)}%`}</dd></div>
              </dl>*/}
              <div className="featured-stats">
                <div><span>MARKET CAP</span><b>{ethUsd.data && t.marketCapEth != null ? fmtCompactUsd(t.marketCapEth * ethUsd.data) : "—"}</b></div>
                <div><span>24H CHANGE</span><b className={t.change24hPercent == null || t.change24hPercent >= 0 ? "change-positive" : "change-negative"}>{t.change24hPercent == null || t.change24hPercent === 0 ? "0.0%" : `${t.change24hPercent > 0 ? "+" : ""}${t.change24hPercent.toFixed(1)}%`}</b></div>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
