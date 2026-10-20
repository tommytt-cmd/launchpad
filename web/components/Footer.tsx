import Link from "next/link";
import { FACTORY, chain } from "@/lib/config";

const explorerUrl = chain.blockExplorers.default.url;
const chainDocsUrl = "https://docs.robinhood.com/chain";
const chainStatusUrl = "https://status.robinhoodchain.offchain.io/";

export function Footer() {
  return (
    <footer className="site-footer">
      <div className="footer-inner">
        <div className="footer-main">
          <div className="footer-identity">
            <Link className="brand-mark footer-brand" href="/" aria-label="Night Market home">NIGHT<span>MARKET</span><i> / RH</i></Link>
            <p>Community-created token markets on Robinhood Chain.</p>
            <span className="footer-network"><i aria-hidden="true" />{chain.name}</span>
          </div>
          <nav className="footer-nav" aria-label="Footer navigation">
            <div>
              <h2>Explore</h2>
              <Link href="/tokens">Explore tokens</Link>
              <Link href="/launch">Launch a token</Link>
              <Link href="/docs">Documentation</Link>
            </div>
            <div>
              <h2>Network</h2>
              <a href={explorerUrl} target="_blank" rel="noreferrer">Block explorer <span aria-hidden="true">↗</span></a>
              <a href={chainDocsUrl} target="_blank" rel="noreferrer">Robinhood Chain docs <span aria-hidden="true">↗</span></a>
              <a href={chainStatusUrl} target="_blank" rel="noreferrer">Network status <span aria-hidden="true">↗</span></a>
            </div>
            <div>
              <h2>Protocol</h2>
              <a href={`${explorerUrl}/address/${FACTORY}`} target="_blank" rel="noreferrer">Launch factory <span aria-hidden="true">↗</span></a>
            </div>
          </nav>
        </div>
        <section className="footer-disclosure" aria-labelledby="footer-disclosure-title">
          <h2 id="footer-disclosure-title">Risk &amp; independence</h2>
          <p>Memecoins are highly speculative and may lose all value. Token listings are community-created and are not endorsements or investment recommendations. Night Market is an independent interface, not affiliated with or endorsed by Robinhood. Testnet tokens and ETH have no redeemable value; market data may be delayed or incomplete. Transactions can fail or be irreversible. Verify contract addresses and do your own research before interacting.</p>
        </section>
        <div className="footer-bottom">
          <span className="footer-copyright">© {new Date().getFullYear()} Night Market</span>
        </div>
      </div>
    </footer>
  );
}