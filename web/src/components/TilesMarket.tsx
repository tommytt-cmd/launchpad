import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Link } from "@/components/Link";
import { resolveTokenImage, type TokenRow } from "@/lib/api";

const INITIAL_PRICE = "0.01";
const tokenHue = (address: string) => `${parseInt(address.slice(2, 8), 16) % 360}deg`;

export function TilesMarket({ token }: { token: TokenRow }) {
  const [selected, setSelected] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);
  const tileDialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = tileDialog.current;
    if (!dialog) return;
    if (modalOpen && !dialog.open) dialog.showModal();
    if (!modalOpen && dialog.open) dialog.close();
  }, [modalOpen]);

  const openTile = (number: number) => {
    setSelected(number);
    setModalOpen(true);
  };
  return (
    <section className="tiles-market-page" style={{ "--token-hue": tokenHue(token.address) } as CSSProperties}>
      {/*<div className="tiles-breadcrumb"><Link href={`/token/${token.address}`}>← {token.name} market</Link><span> / Tiles</span></div>*/}
      <header className="tiles-market-heading">
        {/*<div className="tiles-token-mark">
          {token.image
            ? <img src={resolveTokenImage(token.image)} alt="" referrerPolicy="no-referrer" onError={(event) => { event.currentTarget.style.visibility = "hidden"; }} />
            : <span>{token.symbol.slice(0, 1).toUpperCase()}</span>}
        </div>*/}
        <div className="tiles-title-copy" style={{ paddingTop:'0px' }}>
          {/*<p className="tiles-eyebrow">{token.symbol} · TOKEN-SPECIFIC MARKET</p>*/}
          <h3>{token.name} Tiles</h3>
          <p>Own a position in this token’s fee-sharing pool. Tile ownership is separate from the token and its liquidity.</p>
        </div>
        {/*<span className="tiles-preview-badge"><i /> Market preview</span>*/}
      </header>

      <div className="tiles-market-layout">
        <section className="tiles-board-section" aria-labelledby="tiles-board-title">
          <div className="tiles-board-heading">
            <div><span className="tiles-eyebrow">THE BOARD</span><h2 id="tiles-board-title">100 numbered tiles</h2></div>
            <span className="tiles-selection-hint">Select a tile to inspect</span>
          </div>
          <div className="tiles-board-frame">
            <div className="tiles-grid" role="group" aria-label={`${token.name} tile board`}>
              {Array.from({ length: 100 }, (_, index) => {
                const number = index + 1;
                return <button key={number} className={`market-tile${selected === number ? " is-selected" : ""}`} type="button" aria-haspopup="dialog" aria-label={`Tile ${number}, available for ${INITIAL_PRICE} ETH`} onClick={() => openTile(number)}>
                  <span className="market-tile-number">{String(number).padStart(2, "0")}</span>
                  <span className="market-tile-glyph" aria-hidden="true">{token.symbol.slice(0, 1).toUpperCase()}</span>
                  <span className="market-tile-price">{INITIAL_PRICE} <small>ETH</small></span>
                </button>;
              })}
            </div>
          </div>
          <div className="tiles-legend"><span><i className="legend-available" />Available</span><span><i className="legend-selected" />Selected</span><span className="tiles-legend-note">100 / 100 available · illustrative preview</span></div>
          <p className="tiles-board-footnote">The board shows the proposed starting state. Ownership and availability are not connected to a live contract.</p>
        </section>

        <aside className="tiles-market-aside">
          <div className="tiles-aside-stats">
            <div><span>INITIAL PRICE</span><strong>{INITIAL_PRICE}</strong><small>ETH · proposed</small></div>
            <div><span>AVAILABLE</span><strong>100 <small>/ 100</small></strong><small>Preview state</small></div>
          </div>
          <section className="tiles-selected-card tiles-aside-prompt">
            <span className="tiles-eyebrow">EXPLORE THE BOARD</span>
            <h2>Choose a tile</h2>
            <p>Open any tile to review its proposed price, tax, and fee-sharing details.</p>
          </section>
          <section className="tiles-rules-card">
            <span className="tiles-eyebrow">PROPOSED MECHANICS</span>
            <h2>Rewards stay with the token</h2>
            <p>Eligible trading fees are shared equally per tile through this token’s own reward pool. Past rewards remain with the owner who earned them when a tile transfers.</p>
            <Link href={`/token/${token.address}`}>Back to token market <span aria-hidden="true">↗</span></Link>
          </section>
        </aside>
      </div>
      <dialog ref={tileDialog} className="tile-detail-dialog" onClose={() => setModalOpen(false)} onClick={(event) => { if (event.target === tileDialog.current) setModalOpen(false); }} aria-labelledby="tile-dialog-title">
        <article className="tile-detail-card">
          <div className="tile-detail-art">
            {token.image && <img className="tile-detail-art-image" src={resolveTokenImage(token.image)} alt={`${token.name} token artwork`} referrerPolicy="no-referrer" onError={(event) => { event.currentTarget.style.display = "none"; }} />}
            {!token.image && <span className="tile-detail-art-glyph">{token.symbol.slice(0, 1).toUpperCase()}</span>}
            <span className="tile-detail-rarity">AVAILABLE</span>
            <span className="tile-detail-art-price">{INITIAL_PRICE} ETH</span>
            <button className="tile-detail-close" type="button" aria-label="Close tile details" onClick={() => setModalOpen(false)}>×</button>
          </div>
          <div className="tile-detail-body">
            <h2 id="tile-dialog-title" className="tile-detail-title">{token.symbol} #{String(selected).padStart(2, "0")}</h2>
            <div className="tile-detail-token"><span className="tile-detail-token-mark">{token.symbol.slice(0, 1).toUpperCase()}</span><span><b>{token.name.toUpperCase()}</b><small>Token-specific Tiles market</small></span></div>
            <dl className="tile-detail-facts">
              <div><dt>Price</dt><dd>{INITIAL_PRICE} ETH</dd></div>
              <div><dt>Weekly tax</dt><dd>0.0005 ETH/wk · 5%</dd></div>
              <div><dt>Fee share</dt><dd>Equal per tile</dd></div>
              <div><dt>Avg rewards</dt><dd>Not indexed</dd></div>
              <div><dt>Token rights</dt><dd>None</dd></div>
            </dl>
            <button className="tile-detail-action" type="button" disabled>Buy tile · {INITIAL_PRICE} ETH</button>
            <p className="tile-detail-disclaimer">Proposed terms. Tile contracts are not connected, so purchases and wallet actions are unavailable.</p>
          </div>
        </article>
      </dialog>
    </section>
  );
}
