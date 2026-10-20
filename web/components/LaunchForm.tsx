"use client";
import Image from "next/image";
import { useEffect, useState } from "react";
import { parseEther, formatEther, parseEventLogs, zeroAddress } from "viem";
import { useAccount, useReadContracts, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { FACTORY, HOOK, chain, factoryAbi, friendlyError } from "@/lib/config";

const MAX_ALLOC = 10;

export function LaunchForm() {
  const { isConnected, chainId } = useAccount();
  const [f, setF] = useState({ name: "", symbol: "", desc: "", image: "", site: "", tw: "", tg: "", fdv: "10", budget: "1", fee: "3", hook: "" });
  const [imagePreviewUrl, setImagePreviewUrl] = useState("");
  const [imageUploading, setImageUploading] = useState(false);
  const [imageError, setImageError] = useState("");
  const [showLaunchToast, setShowLaunchToast] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));

  const { data: lim } = useReadContracts({
    contracts: (["launchFee", "minFdv", "maxFdv"] as const).map((functionName) => ({ address: FACTORY, abi: factoryAbi, functionName })),
  });
  const launchFee = (lim?.[0]?.result as bigint | undefined) ?? 0n;
  const minFdv = lim?.[1]?.result as bigint | undefined;
  const maxFdv = lim?.[2]?.result as bigint | undefined;

  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { data: receipt, isLoading: confirming } = useWaitForTransactionReceipt({ hash });
  const token = receipt
    ? parseEventLogs({ abi: factoryAbi, eventName: "Launched", logs: receipt.logs })[0]?.args.token
    : undefined;
  useEffect(() => {
    if (!token) return;
    setShowLaunchToast(true);
    const timeout = window.setTimeout(() => setShowLaunchToast(false), 5000);
    return () => window.clearTimeout(timeout);
  }, [token]);
  const fdv = parseFloat(f.fdv) || 0, budget = parseFloat(f.budget) || 0, fee = parseFloat(f.fee);
  const eff = budget * (1 - fee / 100);
  const pct = fdv > 0 ? (eff / (fdv + eff)) * 100 : 0; // constant-product pool, virtual ETH reserve = fdv
  const over = pct > MAX_ALLOC;

  useEffect(() => {
    if (!imagePreviewUrl.startsWith("blob:")) return;
    return () => URL.revokeObjectURL(imagePreviewUrl);
  }, [imagePreviewUrl]);

  async function uploadImage(file?: File) {
    if (!file) return;
    setImageError("");
    if (file.size > 5 * 1024 * 1024) {
      setImageError("Choose an image smaller than 5 MB.");
      return;
    }
    if (!file.type.startsWith("image/")) {
      setImageError("Choose a supported image file.");
      return;
    }

    setImagePreviewUrl(URL.createObjectURL(file));
    const body = new FormData();
    body.append("file", file);
    setImageUploading(true);
    try {
      const response = await fetch("/api/upload-image", { method: "POST", body });
      const result = await response.json() as { imageUri?: string; error?: string };
      if (!response.ok || !result.imageUri) throw new Error(result.error || "Image upload failed.");
      setF((current) => ({ ...current, image: result.imageUri! }));
    } catch (error) {
      setImageError(error instanceof Error ? error.message : "Image upload failed. Try again.");
    } finally {
      setImageUploading(false);
    }
  }

  let problem = "";
  if (!isConnected || chainId !== chain.id) problem = "Connect your wallet on " + chain.name + ".";
  else if (!f.name.trim() || !f.symbol.trim()) problem = "Enter a token name and ticker.";
  else if (!(budget > 0) || !(fdv > 0)) problem = "Enter a valuation and a first buy above zero.";
  else if (over) problem = "First buy is above 10% of supply.";
  else if (minFdv !== undefined && maxFdv !== undefined && (parseEther(f.fdv) < minFdv || parseEther(f.fdv) > maxFdv))
    problem = `Valuation must be between ${formatEther(minFdv)} and ${formatEther(maxFdv)} ETH.`;

  function submit() {
    const meta = { description: f.desc, image: f.image, website: f.site, twitter: f.tw, telegram: f.tg };
    const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(meta))));
    writeContract({
      address: FACTORY, abi: factoryAbi, functionName: "launch",
      args: [{ name: f.name.trim(), symbol: f.symbol.trim(), metadataURI: "data:application/json;base64," + b64,
        fdv: parseEther(f.fdv), fee: Math.round(fee * 10000), hook: (f.hook || zeroAddress) as `0x${string}` }],
      value: parseEther(f.budget) + launchFee,
    });
  }

  return (
    <div className="launch-form-layout">
      <section className="launch-form-content">
        <h2>Launch a token</h2>
        <p className="lede">One transaction creates the token, opens its trading pool, locks the liquidity, and makes your first buy.</p>
        <div className="panel">
          <div className="row">
            <div><label htmlFor="name">Token name</label><input id="name" value={f.name} onChange={set("name")} maxLength={40} placeholder="Doge" /></div>
            <div><label htmlFor="symbol">Ticker</label><input id="symbol" value={f.symbol} onChange={set("symbol")} maxLength={10} placeholder="DOGE" /></div>
          </div>
          <label htmlFor="desc">Description <small>(optional)</small></label>
          <textarea id="desc" value={f.desc} onChange={set("desc")} maxLength={280} />
          <label htmlFor="image">Token image <small>(optional)</small></label>
          <input id="image" type="file" accept="image/png,image/jpeg,image/webp,image/gif" disabled={imageUploading || isPending || confirming} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; void uploadImage(file); }} />
          <p className="note image-upload-note">PNG, JPEG, WebP, or GIF · up to 5 MB · uploaded publicly to IPFS via Pinata.</p>
          {imageUploading && <p className="note image-upload-status" role="status">Uploading image to IPFS…</p>}
          {imageError && <p className="note bad image-upload-status" role="alert">{imageError}</p>}
          {imagePreviewUrl && <div className="image-upload-preview">
            <Image src={imagePreviewUrl} alt="Selected token artwork preview" width={88} height={88} unoptimized />
            <div><b>{imageError ? "Upload failed" : imageUploading ? "Uploading image" : "Image stored on IPFS"}</b><span>{imageError ? "Choose the file again to retry." : "Ready to include with your launch."}</span></div>
            <button className="alt" type="button" disabled={imageUploading || isPending || confirming} onClick={() => { setF((current) => ({ ...current, image: "" })); setImagePreviewUrl(""); setImageError(""); }}>Remove</button>
          </div>}
          <div className="row">
            <div><label htmlFor="site">Website</label><input id="site" value={f.site} onChange={set("site")} /></div>
            <div><label htmlFor="tw">X / Twitter</label><input id="tw" value={f.tw} onChange={set("tw")} /></div>
          </div>
          <label htmlFor="tg">Telegram</label><input id="tg" value={f.tg} onChange={set("tg")} />
          <div className="row">
            <div><label htmlFor="fdv">Starting valuation <small>(ETH)</small></label><input id="fdv" type="number" min="0" step="any" value={f.fdv} onChange={set("fdv")} /></div>
            <div><label htmlFor="budget">Your first buy <small>(ETH)</small></label><input id="budget" type="number" min="0" step="any" value={f.budget} onChange={set("budget")} /></div>
          </div>
          <label htmlFor="fee">Trading fee: <b>{fee.toFixed(1)}%</b> <small>(you earn 70% of it)</small></label>
          <input id="fee" type="range" min="1" max="5" step="0.5" value={f.fee} onChange={set("fee")} />
          {HOOK && (
            <>
              <label htmlFor="hook">Launch protection</label>
              <select id="hook" value={f.hook} onChange={set("hook")}>
                <option value="">None</option>
                <option value={HOOK}>Anti-snipe (5 min buy cap)</option>
              </select>
              {f.hook && <p className="note">Caps each buy for the first 5 minutes. It limits each transaction, so bots can still split buys.</p>}
            </>
          )}
          <div className="actions">
            <button disabled={!!problem || isPending || confirming || imageUploading} onClick={submit}>
              {isPending ? "Confirm in wallet…" : confirming ? "Launching…" : "Launch token"}
            </button>
          </div>
          {problem && <p className="note">{problem}</p>}
          {error && <p className="note bad">{friendlyError(error)}</p>}
        </div>
      </section>
      {token && showLaunchToast && <div className="launch-toast" role="status" aria-live="polite">
        <span className="live-dot" aria-hidden="true" />
        <div><b>New launch is live</b><span>{f.name} · ${f.symbol}</span></div>
        {chain.blockExplorers && <a href={`${chain.blockExplorers.default.url}/address/${token}`} target="_blank" rel="noopener noreferrer">View ↗</a>}
        <button type="button" aria-label="Dismiss launch notification" onClick={() => setShowLaunchToast(false)}>×</button>
      </div>}
    </div>
  );
}
