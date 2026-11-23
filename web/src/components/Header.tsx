import { useEffect, useRef, useState } from "react";
import { Link } from "@/components/Link";
import { List, X } from "@phosphor-icons/react";
import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { chain } from "@/lib/config";

export function Header() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const headerRef = useRef<HTMLElement>(null);
  const { address, chainId, isConnected } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();
  const wrong = isConnected && chainId !== chain.id;

  useEffect(() => {
    if (!mobileMenuOpen) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (event.target instanceof Node && !headerRef.current?.contains(event.target)) setMobileMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileMenuOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [mobileMenuOpen]);

  return (
    <header className="site-header" ref={headerRef}>
      <div className="brand">
        <Link className="brand-mark" href="/" aria-label="Night Market home">NIGHT<span>MARKET</span></Link>
        <nav className="desktop-nav" aria-label="Main navigation">
          <Link href="/launch">Launch</Link>
          <Link href="/">Tokens</Link>
        </nav>
      </div>
      <div className="hdr">
        {wrong ? (
          <button onClick={() => switchChain({ chainId: chain.id })}>Switch to {chain.name}</button>
        ) : isConnected ? (
          <>
            {/*<span className="pill wallet-pill"><span className="wallet-dot" />{address?.slice(0, 6)}…{address?.slice(-4)}</span>*/}
            <button className="alt" onClick={() => disconnect()}>Disconnect</button>
          </>
        ) : (
          <button className="alt" aria-label="Connect wallet" disabled={isPending} onClick={() => connect({ connector: connectors[0] })}><span className="wallet-label-full" aria-hidden="true">Connect wallet</span><span className="wallet-label-short" aria-hidden="true">Connect</span></button>
        )}
        <button
          className="mobile-menu-toggle"
          type="button"
          aria-label={mobileMenuOpen ? "Close navigation menu" : "Open navigation menu"}
          aria-controls="mobile-site-navigation"
          aria-expanded={mobileMenuOpen}
          onClick={() => setMobileMenuOpen((open) => !open)}
        >
          {mobileMenuOpen ? <X size={21} weight="bold" aria-hidden="true" /> : <List size={22} weight="bold" aria-hidden="true" />}
        </button>
      </div>
      <nav id="mobile-site-navigation" className="mobile-nav" aria-label="Mobile navigation" hidden={!mobileMenuOpen}>
        <Link href="/launch" onClick={() => setMobileMenuOpen(false)}>Launch</Link>
        <Link href="/" onClick={() => setMobileMenuOpen(false)}>Tokens</Link>
      </nav>
    </header>
  );
}
