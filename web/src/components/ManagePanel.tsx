"use client";
import { useState, type CSSProperties } from "react";
import { formatEther, erc20Abi, zeroAddress, type Address } from "viem";
import { useReadContract, useReadContracts, useWriteContract, usePublicClient, useAccount } from "wagmi";
import { FACTORY, chain, factoryAbi, friendlyError } from "@/lib/config";

export function ManagePanel({ token }: { token: string }) {
  const { address: me } = useAccount();
  const publicClient = usePublicClient();
  const [claimStep, setClaimStep] = useState<"idle" | "harvesting" | "claiming">("idle");
  const [claimFlowError, setClaimFlowError] = useState<string | null>(null);
  const t = token as Address;

  const { data: l, refetch: r1 } = useReadContract({ address: FACTORY, abi: factoryAbi, functionName: "launches", args: [t], query: { enabled: true } });
  const creator = l?.[0] as Address | undefined;
  const known = !!creator && creator !== zeroAddress;
  const isCreator = !!me && !!creator && me.toLowerCase() === creator.toLowerCase();

  const { data: d, refetch: r2 } = useReadContracts({
    contracts: [
      { address: FACTORY, abi: factoryAbi, functionName: "creatorEth", args: [t] },
      { address: t, abi: erc20Abi, functionName: "balanceOf", args: [creator as Address] },
    ],
    query: { enabled: known },
  });

  const { writeContractAsync, isPending } = useWriteContract();
  const holdSnapshot = (l?.[5] as bigint | undefined) ?? 0n;
  const bal = (d?.[1]?.result as bigint | undefined) ?? 0n;
  const blocked = bal < holdSnapshot;
  const busy = isPending || claimStep !== "idle";
  const explorer = chain.blockExplorers?.default.url;

  async function claimEarnings() {
    if (!publicClient || busy || blocked) return;
    let step: "harvesting" | "claiming" = "harvesting";
    setClaimFlowError(null);
    setClaimStep("harvesting");
    try {
      const harvestHash = await writeContractAsync({ address: FACTORY, abi: factoryAbi, functionName: "harvest", args: [t] });
      const harvestReceipt = await publicClient.waitForTransactionReceipt({ hash: harvestHash });
      if (harvestReceipt.status !== "success") throw new Error("Fee collection failed, so earnings were not claimed.");
      await Promise.all([r1(), r2()]);

      step = "claiming";
      setClaimStep("claiming");
      const claimHash = await writeContractAsync({ address: FACTORY, abi: factoryAbi, functionName: "claim", args: [t] });
      const claimReceipt = await publicClient.waitForTransactionReceipt({ hash: claimHash });
      if (claimReceipt.status !== "success") throw new Error("Fees were collected, but the claim transaction failed.");
      await Promise.all([r1(), r2()]);
    } catch (error) {
      const message = friendlyError(error);
      setClaimFlowError(step === "claiming" ? `Fees may already be collected. Claim failed: ${message}` : message);
    } finally {
      setClaimStep("idle");
    }
  }

  if (!known) return null;

  return (
    <section className="panel token-earnings-card" id="token-earnings" style={{ "--token-hue": `${Number.parseInt(t.slice(2, 8), 16) % 360}deg` } as CSSProperties}>
      <h2>Fee earnings</h2>
      <p className="token-earnings-description">Unclaimed fees earned in the paired currency.</p>
      <div className="token-earnings-summary">
        <div className="stat"><span>Total earnings</span><b>{formatEther((d?.[0]?.result as bigint) ?? 0n)} ETH</b></div>
        <div className="stat"><span>Creator</span><b>{explorer ? <a href={`${explorer}/address/${creator}`} target="_blank" rel="noopener noreferrer" title={creator}>{creator.slice(0, 6)}…{creator.slice(-4)} ↗</a> : `${creator.slice(0, 6)}…${creator.slice(-4)}`}</b></div>
      </div>
      {isCreator && <>
        <p className={"note " + (blocked ? "bad" : "ok")}>{blocked ? "Claims are paused until your token balance reaches the launch requirement." : "Your creator claim is available."}</p>
        <div className="actions">
          <button disabled={busy || blocked || !publicClient} onClick={() => void claimEarnings()}>
            {claimStep === "harvesting" ? "Collecting fees…" : claimStep === "claiming" ? "Claiming earnings…" : "Claim earnings"}
          </button>
        </div>
        <p className="note">This collects pool fees, then claims your earnings. Confirm both transactions in your wallet.</p>
        {claimFlowError && <p className="note bad">{claimFlowError}</p>}
      </>}
    </section>
  );
}
