import type { Metadata } from "next";
import Link from "next/link";
import { Header } from "@/components/Header";
import { FACTORY, HOOK, PERMIT2, POOL_MANAGER, V4_QUOTER, V4_ROUTER, chain } from "@/lib/config";

export const metadata: Metadata = {
  title: "Documentation | Night Market",
  description: "How to launch, trade, and manage community-created tokens on Night Market.",
};

const pages = [
  { title: "Getting started", lede: "Understand Night Market and prepare your wallet before you launch or trade." },
  { title: "Create a token", lede: "Configure a launch, understand the optional protection hook, and review the transaction." },
  { title: "Trading and fees", lede: "Learn how to buy and sell tokens and how creator fees are collected." },
  { title: "Contract reference", lede: "Verify the active deployment and review the factory methods used by Night Market." },
  { title: "Risks and limitations", lede: "Review the prototype, testnet, contract, and trading risks before interacting." },
] as const;

const sections = [
  ["overview", "Overview", 0],
  ["get-started", "Get started", 0],
  ["launch", "Launch a token", 1],
  ["protection", "Launch protection", 1],
  ["trade", "Buy and sell", 2],
  ["creator-fees", "Creator fees", 2],
  ["contracts", "Contracts", 3],
  ["risks", "Risks and limitations", 4],
] as const;

function Address({ value }: { value: string }) {
  return <code className="docs-address">{value}</code>;
}

export default async function DocsPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const requestedPage = Number((await searchParams).page ?? 0);
  const pageIndex = Number.isInteger(requestedPage) ? Math.min(Math.max(requestedPage, 0), pages.length - 1) : 0;
  const currentPage = pages[pageIndex];
  const currentSections = sections.filter(([, , page]) => page === pageIndex);
  const explorer = chain.blockExplorers.default.url;

  return (
    <>
      <Header />
      <main className="docs-main">
        <div className="docs-breadcrumb"><Link href="/">Night Market</Link><span>/</span><span>Documentation</span></div>
        <div className="docs-layout">
          <nav className="docs-sidebar" aria-label="Documentation sections">
            <p>GUIDES</p>
            {pages.map((page, index) => <Link href={`/docs?page=${index}`} key={page.title} aria-current={pageIndex === index ? "page" : undefined}><span>{String(index + 1).padStart(2, "0")}</span>{page.title}</Link>)}
            <div className="docs-sidebar-links">
              <a href="https://docs.robinhood.com/chain" target="_blank" rel="noreferrer">Robinhood Chain docs ↗</a>
              <a href={explorer} target="_blank" rel="noreferrer">Block explorer ↗</a>
            </div>
          </nav>

          <article className="docs-article">
            <div className="docs-kicker"><span className="live-dot" /> PRODUCT DOCUMENTATION <span>·</span> {chain.name.toUpperCase()}</div>
            <h1>{currentPage.title}</h1>
            <p className="docs-lede">{currentPage.lede}</p>
            <div className="docs-callout docs-callout-warning"><b>Testnet prototype</b><p>This launchpad and its contracts are unaudited. Testnet tokens and ETH have no redeemable value. Do not use real funds or treat a token listing as an endorsement.</p></div>

            <section id="overview" className="docs-section" hidden={pageIndex !== 0}>
              <p className="docs-eyebrow">START HERE</p>
              <h2>Overview</h2>
              <p>Night Market is an independent interface for community-created ERC-20 tokens. A launch creates a fixed-supply token and a native ETH/token Uniswap v4 pool. The factory adds the token supply as single-sided liquidity, then makes the creator&apos;s initial buy in the same transaction.</p>
              <div className="docs-facts">
                <div><span>NETWORK</span><b>{chain.name}</b></div>
                <div><span>CHAIN ID</span><b>{chain.id}</b></div>
                <div><span>TOKEN SUPPLY</span><b>1,000,000,000</b></div>
                <div><span>QUOTE ASSET</span><b>Native ETH</b></div>
              </div>
            </section>

            <section id="get-started" className="docs-section" hidden={pageIndex !== 0}>
              <p className="docs-eyebrow">BEFORE YOU BEGIN</p>
              <h2>Get started</h2>
              <ol className="docs-steps">
                <li><b>Use a compatible wallet.</b> Connect a wallet that supports EVM networks and switch it to {chain.name}.</li>
                <li><b>Get testnet ETH.</b> You need ETH for gas, the launch fee, and any buy or sell. Testnet ETH is not real or redeemable.</li>
                <li><b>Verify the network.</b> Confirm the chain name and chain ID ({chain.id}) in your wallet before signing. Check transactions and contract addresses in the <a href={explorer} target="_blank" rel="noreferrer">block explorer</a>.</li>
              </ol>
              <p>Start at <Link href="/tokens">Tokens</Link> to browse markets, or go to <Link href="/launch">Launch</Link> to create a token.</p>
            </section>

            <section id="launch" className="docs-section" hidden={pageIndex !== 1}>
              <p className="docs-eyebrow">CREATOR GUIDE</p>
              <h2>Launch a token</h2>
              <p>Open <Link href="/launch">Launch</Link>, connect the creator wallet, and provide a name and ticker. Description, token image, website, X/Twitter, and Telegram metadata are optional. Images are uploaded to public IPFS storage through Pinata; the resulting <code>ipfs://</code> URI is embedded in the launch event for the indexer. Metadata is not stored as editable token state on the ERC-20 contract.</p>
              <ol className="docs-steps">
                <li><b>Choose a starting valuation.</b> The current factory bounds are 1–1,000 ETH FDV. Initial price snaps to the v4 tick grid and may differ from the requested value by about 2%.</li>
                <li><b>Set your first-buy budget.</b> The budget is separate from the launch fee. Unused ETH is refunded. Your initial allocation cannot exceed 10% of total supply.</li>
                <li><b>Set the pool trading fee.</b> Choose 1%–5%. The fee is charged on pool swaps and accrues to the factory-owned liquidity position.</li>
                <li><b>Review and sign.</b> The wallet transaction calls <code>LaunchFactory.launch</code>, creates the token and pool, adds liquidity, and executes the creator buy atomically.</li>
              </ol>
              <div className="docs-callout"><b>Current launch fee: 0.0004 ETH</b><p>The factory owner can change this fee and the FDV bounds. The values shown by the launch form are read from the deployed factory.</p></div>
              <pre><code>{`LaunchFactory.launch(LaunchParams({
  name: "Example",
  symbol: "EX",
  metadataURI: "<encoded metadata>",
  fdv: <starting FDV in wei>,
  fee: <10000 to 50000>, // 1% to 5%, in hundredths of a bip
  hook: address(0) // or an approved hook
}), { value: launchFee + firstBuyBudget });`}</code></pre>
            </section>

            <section id="trade" className="docs-section" hidden={pageIndex !== 2}>
              <p className="docs-eyebrow">TRADER GUIDE</p>
              <h2>Buy and sell</h2>
              <p>Open a token market, connect your wallet to the correct chain, choose Buy or Sell, select an amount, review the live quote and minimum output, then confirm the transaction. The app routes native ETH/token swaps through the configured Uniswap v4 Universal Router.</p>
              <ul>
                <li><b>Slippage:</b> the swap form defaults to 0.5%; the supported input is 0.1%–50%. Minimum output is derived from the current quote and your slippage setting.</li>
                <li><b>Buying:</b> uses native ETH and does not require token approval.</li>
                <li><b>Selling:</b> requires ERC-20 approval for Permit2 and a Permit2 approval for the router. Use <b>Authorize token</b> in the swap panel; approvals are separate wallet transactions.</li>
                <li><b>Check the details:</b> quotes can change before confirmation. Verify the token address, amount, and minimum output before signing.</li>
              </ul>
              <div className="docs-callout"><b>Router availability</b><p>Swap support depends on the router and quoter being configured for the active deployment. If the panel reports incomplete configuration, do not attempt to route through an unrelated router.</p></div>
            </section>

            <section id="protection" className="docs-section" hidden={pageIndex !== 1}>
              <p className="docs-eyebrow">OPTIONAL HOOK</p>
              <h2>Launch protection</h2>
              <p>The approved AntiSnipeHook applies a temporary cap to each buy after the creator&apos;s initial buy. Sells are not capped.</p>
              <div className="docs-table-wrap"><table className="docs-table"><thead><tr><th>Time since launch</th><th>Maximum per buy</th></tr></thead><tbody><tr><td>0–60 seconds</td><td>0.25% of supply</td></tr><tr><td>60–300 seconds</td><td>Rises linearly to 2% of supply</td></tr><tr><td>After 5 minutes</td><td>No hook cap</td></tr></tbody></table></div>
              <div className="docs-callout docs-callout-warning"><b>A speed bump, not bot prevention</b><p>The limit is per transaction, not per wallet. Buyers can split orders across transactions or wallets. A hook is trusted code that runs during swaps; only use hooks approved by the factory owner.</p></div>
            </section>

            <section id="creator-fees" className="docs-section" hidden={pageIndex !== 2}>
              <p className="docs-eyebrow">CREATOR GUIDE</p>
              <h2>Creator fees</h2>
              <p>Trading fees accrue to the factory-owned liquidity position. They are not automatically sent to the creator.</p>
              <ol className="docs-steps">
                <li><b>Collect fees.</b> On the token page, the creator can call <code>harvest(token)</code> to move accrued fees into escrow. Anyone may submit this call.</li>
                <li><b>Claim your share.</b> The creator can call <code>claim(token)</code>; anyone may trigger it, but funds always go to the recorded creator.</li>
                <li><b>Keep the launch balance.</b> Claiming is gated: the creator must still hold at least the token balance they received in the initial buy. This check can be gamed by temporarily borrowing tokens; it is not a security guarantee.</li>
              </ol>
              <p>After any applicable pool protocol fee, 70% of harvested fees are credited to the creator and 30% to the platform. Fees are held in the swap input asset: ETH from buys and tokens from sells. The creator share is claimable in both assets.</p>
              <pre><code>{`// Permissionless collection; accrued amounts are escrowed
LaunchFactory.harvest(token);

// Permissionless trigger; proceeds always go to the creator
LaunchFactory.claim(token);`}</code></pre>
            </section>

            <section id="contracts" className="docs-section" hidden={pageIndex !== 3}>
              <p className="docs-eyebrow">REFERENCE</p>
              <h2>Contracts</h2>
              <p>These are the current configured {chain.name} addresses. Always confirm the chain and address in the explorer before interacting; deployments and configuration can change.</p>
              <div className="docs-contract-list">
                <div><span>LaunchFactory</span><a href={`${explorer}/address/${FACTORY}`} target="_blank" rel="noreferrer"><Address value={FACTORY} /> ↗</a></div>
                <div><span>AntiSnipeHook</span><a href={`${explorer}/address/${HOOK}`} target="_blank" rel="noreferrer"><Address value={HOOK} /> ↗</a></div>
                <div><span>PoolManager</span><a href={`${explorer}/address/${POOL_MANAGER}`} target="_blank" rel="noreferrer"><Address value={POOL_MANAGER} /> ↗</a></div>
                {V4_ROUTER && <div><span>Universal Router</span><a href={`${explorer}/address/${V4_ROUTER}`} target="_blank" rel="noreferrer"><Address value={V4_ROUTER} /> ↗</a></div>}
                {V4_QUOTER && <div><span>V4 Quoter</span><a href={`${explorer}/address/${V4_QUOTER}`} target="_blank" rel="noreferrer"><Address value={V4_QUOTER} /> ↗</a></div>}
                <div><span>Permit2</span><a href={`${explorer}/address/${PERMIT2}`} target="_blank" rel="noreferrer"><Address value={PERMIT2} /> ↗</a></div>
              </div>
              <h3>Useful factory methods</h3>
              <div className="docs-methods"><code>launch(LaunchParams)</code><span>Deploy a token, initialize its pool, add liquidity, and execute the creator buy.</span><code>launches(token)</code><span>Read the creator, hook, pool fee, ticks, and hold snapshot.</span><code>harvest(token)</code><span>Collect position fees into creator/platform escrow.</span><code>claim(token)</code><span>Pay the claimable creator share to the recorded creator.</span><code>approvedHook(hook)</code><span>Check whether the factory currently approves a hook.</span></div>
              <p>Token contracts have a fixed supply of 1 billion with 18 decimals. They have no mint function or token owner. The factory owns the liquidity position; its current code contains no liquidity-removal path.</p>
            </section>

            <section id="risks" className="docs-section" hidden={pageIndex !== 4}>
              <p className="docs-eyebrow">READ BEFORE INTERACTING</p>
              <h2>Risks and limitations</h2>
              <ul>
                <li><b>Unaudited prototype.</b> Contracts and app integrations have not been professionally audited. This deployment is for testnet experimentation only.</li>
                <li><b>Speculative tokens.</b> Memecoins are highly volatile and may lose all value. Listings are community-created, not reviewed investment recommendations, and not endorsements by Night Market or Robinhood.</li>
                <li><b>Testnet isolation.</b> These pools are on an isolated v4 deployment. They are not Robinhood mainnet or Unichain pools and are not automatically visible in other apps or aggregators. Testnet ETH and tokens have no redeemable value.</li>
                <li><b>Hook and admin trust.</b> The factory owner can change launch fees, valuation bounds, and approved hooks. A malicious hook can disrupt trading. Review hook addresses before choosing one.</li>
                <li><b>Market and transaction risk.</b> Data may be delayed or incomplete. Quotes can move, transactions can fail, and confirmed transactions may be irreversible. Never share a seed phrase or sign an unexpected approval.</li>
                <li><b>Test deployment limits.</b> The documented test router supports native ETH/v4 token swaps. WETH wrapping, v2/v3 swaps, position-manager commands, bridging, and automatic aggregator discovery are not part of this deployment.</li>
              </ul>
              <p>For Robinhood Chain network setup and supported RPC details, see the official <a href="https://docs.robinhood.com/chain" target="_blank" rel="noreferrer">Robinhood Chain documentation</a>.</p>
            </section>

            <nav className="docs-pagination" aria-label="Documentation pages">
              {pageIndex > 0 ? <Link className="docs-pagination-link docs-pagination-previous" href={`/docs?page=${pageIndex - 1}`}><span>PREVIOUS</span><b><i aria-hidden="true">←</i>{pages[pageIndex - 1].title}</b></Link> : <span className="docs-pagination-spacer" />}
              <span className="docs-pagination-count">{pageIndex + 1} / {pages.length}</span>
              {pageIndex < pages.length - 1 ? <Link className="docs-pagination-link docs-pagination-next" href={`/docs?page=${pageIndex + 1}`}><span>NEXT</span><b>{pages[pageIndex + 1].title}<i aria-hidden="true">→</i></b></Link> : <Link className="docs-pagination-link docs-pagination-next" href="/tokens"><span>FINISH</span><b>Browse token markets<i aria-hidden="true">→</i></b></Link>}
            </nav>
          </article>

          <aside className="docs-toc" aria-label="On this page"><p>ON THIS PAGE</p>{currentSections.map(([id, title]) => <a href={`#${id}`} key={id}>{title}</a>)}</aside>
        </div>
      </main>
    </>
  );
}