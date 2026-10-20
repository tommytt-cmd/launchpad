"use client";
import { useEffect } from "react";
import { formatEther, erc20Abi, zeroAddress, type Address } from "viem";
import { useReadContract, useReadContracts, useWriteContract, useWaitForTransactionReceipt, useAccount } from "wagmi";
import { FACTORY, factoryAbi, friendlyError } from "@/lib/config";

export function ManagePanel({ token }: { token: string }) {
  const { address: me } = useAccount();
  const t = token as Address;

  const { data: l, refetch: r1 } = useReadContract({ address: FACTORY, abi: factoryAbi, functionName: "launches", args: [t], query: { enabled: true } });
  const creator = l?.[0] as Address | undefined;
  const known = !!creator && creator !== zeroAddress;
  const isCreator = !!me && !!creator && me.toLowerCase() === creator.toLowerCase();

  const { data: d, refetch: r2 } = useReadContracts({
    contracts: [
      { address: FACTORY, abi: factoryAbi, functionName: "creatorEth", args: [t] },
      { address: FACTORY, abi: factoryAbi, functionName: "creatorToken", args: [t] },
      { address: t, abi: erc20Abi, functionName: "balanceOf", args: [creator as Address] },
      { address: t, abi: erc20Abi, functionName: "symbol" },
    ],
    query: { enabled: known },
  });

  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: confirming, isSuccess } = useWaitForTransactionReceipt({ hash });
  useEffect(() => { if (isSuccess) { r1(); r2(); } }, [isSuccess]); // eslint-disable-line

  const run = (fn: "harvest" | "claim") => writeContract({ address: FACTORY, abi: factoryAbi, functionName: fn, args: [t] });
  const holdSnapshot = (l?.[5] as bigint | undefined) ?? 0n;
  const bal = (d?.[2]?.result as bigint | undefined) ?? 0n;
  const sym = (d?.[3]?.result as string | undefined) ?? "tokens";
  const blocked = bal < holdSnapshot;
  const busy = isPending || confirming;

  if (!known || !isCreator) return null;

  return (
    <section>
      <h2>Manage your token</h2>
      <p className="lede">Collect trading fees and claim your share. Claims need the creator to still hold at least what they bought at launch.</p>
      <div className="panel">
        {known && isCreator && (
          <div style={{ marginTop: 12 }}>
            <div className="stat"><span>Creator</span><b>{creator}{creator?.toLowerCase() === me?.toLowerCase() ? " (you)" : ""}</b></div>
            <div className="stat"><span>Trading fee</span><b>{Number(l?.[2]) / 10000}%</b></div>
            <div className="stat"><span>Claimable ETH</span><b>{formatEther((d?.[0]?.result as bigint) ?? 0n)}</b></div>
            <div className="stat"><span>Claimable {sym}</span><b>{formatEther((d?.[1]?.result as bigint) ?? 0n)}</b></div>
            <div className="stat"><span>Must hold at least</span><b>{formatEther(holdSnapshot)} {sym}</b></div>
            <div className="stat"><span>Creator holds</span><b className={blocked ? "bad" : "ok"}>{formatEther(bal)} {sym}</b></div>
            <p className={"note " + (blocked ? "bad" : "")}>{blocked ? "Claims are blocked until the creator&apos;s balance is back at the amount above." : "Claims are open."}</p>
            <div className="actions">
              <button className="alt" disabled={busy} onClick={() => run("harvest")}>Collect fees</button>
              <button disabled={busy || blocked} onClick={() => run("claim")}>Claim to creator</button>
            </div>
            <p className="note">Collect fees moves new trading fees into the claimable balance. Anyone can run it; claimed funds always go to the creator.</p>
            {error && <p className="note bad">{friendlyError(error)}</p>}
          </div>
        )}
      </div>
    </section>
  );
}
