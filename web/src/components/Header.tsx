import { Link } from "@/components/Link";
import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { chain } from "@/lib/config";

export function Header() {
  const { address, chainId, isConnected } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();
  const wrong = isConnected && chainId !== chain.id;

  return (
    <header className="site-header">
      <div className="brand">
        <Link className="brand-mark" href="/" aria-label="Night Market home">NIGHT<span>MARKET</span></Link>
        <nav>
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
      </div>
    </header>
  );
}
