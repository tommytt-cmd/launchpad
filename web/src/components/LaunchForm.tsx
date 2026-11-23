import { useEffect, useState, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { parseEther, formatEther, parseEventLogs, zeroAddress } from "viem";
import { useAccount, useReadContracts, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { FACTORY, HOOK, chain, factoryAbi, friendlyError } from "@/lib/config";
import { fetchEthUsd } from "@/lib/api";

const MAX_ALLOC = 10;
const LAUNCH_STEPS = ["Token details", "Token artwork", "Social links", "Launch settings"];

export function LaunchForm() {
  const navigate = useNavigate();
  const { isConnected, chainId } = useAccount();
  const [f, setF] = useState({ name: "", symbol: "", desc: "", image: "", site: "", tw: "", tg: "", budget: "1", fee: "3", hook: "" });
  const [imagePreviewUrl, setImagePreviewUrl] = useState("");
  const [imageUploading, setImageUploading] = useState(false);
  const [imageError, setImageError] = useState("");
  const [activeStep, setActiveStep] = useState(0);
  const [stepError, setStepError] = useState("");
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));

  const { data: ethUsd, error: ethUsdError } = useQuery({ queryKey: ["eth-usd-reference"], queryFn: fetchEthUsd, refetchInterval: 60_000, staleTime: 30_000, retry: false });
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
    void navigate({ to: "/token/$address", params: { address: token } });
  }, [navigate, token]);
  const fdv = ethUsd ? 4500 / ethUsd : 0;
  const fdvWei = ethUsd ? parseEther(fdv.toFixed(18)) : 0n;
  const budget = parseFloat(f.budget) || 0, fee = parseFloat(f.fee);
  const eff = budget * (1 - fee / 100);
  const pct = fdv > 0 ? (eff / (fdv + eff)) * 100 : 0;
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
  else if (!ethUsd) problem = "ETH/USD price is unavailable; the fixed $4.5k launch valuation cannot be calculated.";
  else if (!f.name.trim() || !f.symbol.trim()) problem = "Enter a token name and ticker.";
  else if (!(budget > 0)) problem = "Enter a first buy above zero.";
  else if (over) problem = "First buy is above 10% of supply.";
  else if (minFdv !== undefined && maxFdv !== undefined && (fdvWei < minFdv || fdvWei > maxFdv))
    problem = `Valuation must be between ${formatEther(minFdv)} and ${formatEther(maxFdv)} ETH.`;

  function moveToStep(step: number) {
    setActiveStep(step);
    setStepError("");
  }

  function nextStep() {
    let message = "";
    if (activeStep === 0 && (!f.name.trim() || !f.symbol.trim())) {
      message = "Enter a token name and ticker to continue.";
    } else if (activeStep === 1 && imageUploading) {
      message = "Wait for your artwork upload to finish before continuing.";
    }
    if (message) {
      setStepError(message);
      return;
    }
    moveToStep(Math.min(activeStep + 1, LAUNCH_STEPS.length - 1));
  }

  function submit() {
    const meta = { description: f.desc, image: f.image, website: f.site, twitter: f.tw, telegram: f.tg };
    const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(meta))));
    writeContract({
      address: FACTORY, abi: factoryAbi, functionName: "launch",
      args: [{ name: f.name.trim(), symbol: f.symbol.trim(), metadataURI: "data:application/json;base64," + b64,
        fdv: fdvWei, fee: Math.round(fee * 10000), hook: (f.hook || zeroAddress) as `0x${string}` }],
      value: parseEther(f.budget) + launchFee,
    });
  }

  const stepContent = [
    <section className="launch-form-section" key="details">
      <div className="launch-form-section-heading"><div><h3>Token details</h3><p>Set the name and identity for your launch.</p></div></div>
      <div className="row launch-identity-row">
        <div><label htmlFor="name">Token name</label><input id="name" value={f.name} onChange={set("name")} maxLength={40} placeholder="Doge" /></div>
        <div><label htmlFor="symbol">Ticker</label><input id="symbol" value={f.symbol} onChange={set("symbol")} maxLength={10} placeholder="DOGE" /></div>
      </div>
      <label htmlFor="desc">Description <small>(optional)</small></label><textarea id="desc" value={f.desc} onChange={set("desc")} maxLength={280} placeholder="What is your token about?" />
    </section>,
    <section className="launch-form-section" key="artwork">
      <div className="launch-form-section-heading"><div><h3>Token artwork</h3><p>Add an image to give your token a recognizable look.</p></div></div>
      <label htmlFor="image">Token image <small>(optional)</small></label>
      <input id="image" type="file" accept="image/png,image/jpeg,image/webp,image/gif" disabled={imageUploading || isPending || confirming} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; void uploadImage(file); }} />
      <p className="note image-upload-note">PNG, JPEG, WebP, or GIF · up to 5 MB · uploaded publicly to IPFS via Pinata.</p>
      {imageUploading && <p className="note image-upload-status" role="status">Uploading image to IPFS…</p>}
      {imageError && <p className="note bad image-upload-status" role="alert">{imageError}</p>}
      {imagePreviewUrl && <div className="image-upload-preview">
        <img src={imagePreviewUrl} alt="Selected token artwork preview" width={88} height={88} />
        <div><b>{imageError ? "Upload failed" : imageUploading ? "Uploading image" : "Image stored on IPFS"}</b><span>{imageError ? "Choose the file again to retry." : "Ready to include with your launch."}</span></div>
        <button className="alt" type="button" disabled={imageUploading || isPending || confirming} onClick={() => { setF((current) => ({ ...current, image: "" })); setImagePreviewUrl(""); setImageError(""); }}>Remove</button>
      </div>}
    </section>,
    <section className="launch-form-section" key="social">
      <div className="launch-form-section-heading"><div><h3>Social links</h3><p>Help people find your project online.</p></div></div>
      <label htmlFor="site">Website <small>(optional)</small></label><input id="site" value={f.site} onChange={set("site")} placeholder="https://" />
      <label htmlFor="tw">X / Twitter <small>(optional)</small></label><input id="tw" value={f.tw} onChange={set("tw")} placeholder="https://x.com/" />
      <label htmlFor="tg">Telegram <small>(optional)</small></label><input id="tg" value={f.tg} onChange={set("tg")} placeholder="https://t.me/" />
    </section>,
    <section className="launch-form-section" key="settings">
      <div className="launch-form-section-heading"><div><h3>Launch settings</h3><p>Choose your opening valuation and buy.</p></div></div>
      <div className="launch-settings-row">
        <div><label htmlFor="budget">Your first buy <small>(ETH)</small></label><input id="budget" type="number" min="0" step="any" value={f.budget} onChange={set("budget")} /></div>
        {HOOK && <div className=""><label htmlFor="hook">Snipe protection</label><select id="hook" value={f.hook} onChange={set("hook")}><option value="">None</option><option value={HOOK}>Anti-snipe (5 min buy cap)</option></select>{/*f.hook && <p className="note">Caps each buy for the first 5 minutes. It limits each transaction, so bots can still split buys.</p>*/}</div>}
      </div>
      <div className="launch-fee-setting"><label htmlFor="fee">Tax <b>{fee.toFixed(1)}%</b> {/*<small>· you earn 70% of it</small>*/}</label><input id="fee" type="range" min="1" max="5" step="0.5" value={f.fee} style={{ "--fee-progress": `${((fee - 1) / 4) * 100}%` } as CSSProperties} onChange={set("fee")} /><div className="launch-fee-range"><span>1%</span><span>5%</span></div></div>
      
    </section>,
  ];

  return (
    <div className="launch-form-layout">
      <section className="launch-form-content">
        <h2>Launch a token</h2>
        <p className="lede">One transaction creates the token, opens its trading pool, locks the liquidity, and makes your first buy.</p>
        <div className="launch-preview-card" aria-label="Live token launch preview">
          <div className="launch-preview-art-stage">
            {imagePreviewUrl
              ? <img src={imagePreviewUrl} alt="" />
              : <span>{f.symbol.trim().slice(0, 1).toUpperCase() || f.name.trim().slice(0, 1).toUpperCase() || "✳"}</span>}
          </div>
          <div className="launch-preview-copy">
            <p className="launch-preview-kicker">TOKEN PREVIEW <span>·</span> {chain.name.toUpperCase()}</p>
            <div className="launch-preview-title-row"><h3>{f.name.trim() || "Your token name"}</h3><span>${f.symbol.trim() || "TICKER"}</span></div>
            {f.desc.trim() && <p className="launch-preview-description">{f.desc.trim()}</p>}
            <div className="launch-preview-stats">
              <div><span>MARKET CAP</span><b>$4.5k</b></div>
              <div><span>FIRST BUY</span><b>{f.budget || "0"} ETH</b></div>
              <div><span>SUPPLY</span><b>1B</b></div>
              <div><span>TAX</span><b>{fee.toFixed(1)}% / {fee.toFixed(1)}%</b></div>
            </div>
          </div>
          <div className="launch-preview-watermark" aria-hidden="true">{f.symbol.trim().slice(0, 1).toUpperCase() || "✳"}</div>
        </div>
        <div className="panel launch-form-panel">
          <nav className="launch-stepper" aria-label="Launch steps">
            {LAUNCH_STEPS.map((step, index) => <button key={step} type="button" className={index === activeStep ? "is-current" : index < activeStep ? "is-complete" : ""} aria-current={index === activeStep ? "step" : undefined} disabled={index > activeStep} onClick={() => moveToStep(index)}><span>{index < activeStep ? "✓" : `0${index + 1}`}</span><b>{step}</b></button>)}
          </nav>
          <div className="launch-step-panel" key={activeStep}>{stepContent[activeStep]}</div>
          <div className="launch-form-submit">
            <div className="launch-step-navigation">
              {activeStep > 0 && <button className="launch-back-button" type="button" onClick={() => moveToStep(activeStep - 1)}>← Back</button>}
              {activeStep < LAUNCH_STEPS.length - 1
                ? <button className="launch-next-button" type="button" onClick={nextStep}>Next step <span aria-hidden="true">→</span></button>
                : <button className="launch-next-button launch-submit-button" type="button" disabled={!!problem || isPending || confirming || imageUploading} onClick={submit}>{isPending ? "Confirm in wallet…" : confirming ? "Launching…" : "Launch token"}</button>}
            </div>
            {stepError && <p className="note bad" role="alert">{stepError}</p>}
            {activeStep === LAUNCH_STEPS.length - 1 && problem && <p className="note">{problem}</p>}
            {activeStep === LAUNCH_STEPS.length - 1 && error && <p className="note bad" role="alert">{friendlyError(error)}</p>}
          </div>
        </div>
      </section>
    </div>
  );
}
