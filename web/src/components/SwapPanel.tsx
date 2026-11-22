"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { formatEther, formatUnits, isAddress, parseEther } from "viem";
import { useAccount, useBalance, usePublicClient, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { chain, PERMIT2, V4_QUOTER, V4_ROUTER, friendlyError } from "@/lib/config";
import { fetchToken, fetchTokens } from "@/lib/api";
import {
  buildPoolKey,
  buildUniversalRouterExactInputSingle,
  permit2Abi,
  tokenApprovalAbi,
  universalRouterAbi,
  v4QuoterAbi,
  type SwapDirection,
} from "@/lib/v4Router";

const MAX_SIGNED_INT128 = (1n << 127n) - 1n;
const MAX_UINT256 = (1n << 256n) - 1n;
const MAX_UINT160 = (1n << 160n) - 1n;
const MAX_UINT48 = (1n << 48n) - 1n;

export function SwapPanel({
  token,
  tokenSymbol,
  poolFee,
  poolHook,
  initialDirection,
}: {
  token?: string;
  tokenSymbol?: string;
  poolFee?: number;
  poolHook?: string;
  initialDirection?: SwapDirection;
}) {
  const { isConnected, chainId, address } = useAccount();
  const publicClient = usePublicClient();
  const [direction, setDirection] = useState<SwapDirection>("buy");
  const [amount, setAmount] = useState("0.0001");
  const [selectedToken, setSelectedToken] = useState(token ?? "");
  const [slippage, setSlippage] = useState("0.5");
  const recipient = address ?? "";
  const [approvalPending, setApprovalPending] = useState(false);
  const [approvalMessage, setApprovalMessage] = useState("");
  const [approvalError, setApprovalError] = useState("");
  const [transactionHash, setTransactionHash] = useState<`0x${string}`>();

  const routerConfigured = Boolean(V4_ROUTER && V4_ROUTER.length === 42);
  const correctNetwork = chainId === chain.id;
  const routerReady = routerConfigured && correctNetwork;
  const activeToken = selectedToken;
  const activeTokenHue = isAddress(activeToken) ? `${parseInt(activeToken.slice(2, 8), 16) % 360}deg` : "145deg";
  const payBalance = useBalance({
    address,
    token: direction === "sell" && isAddress(activeToken) ? activeToken : undefined,
    query: { enabled: Boolean(address) && (direction === "buy" || isAddress(activeToken)) },
  });

  useEffect(() => setSelectedToken(token ?? ""), [token]);

  const tokens = useQuery({
    queryKey: ["swap-token-options"],
    queryFn: () => fetchTokens("new", ""),
    staleTime: 30_000,
    retry: false,
  });

  const tokenDetails = useQuery({
    queryKey: ["swap-pool-config", activeToken],
    queryFn: () => fetchToken(activeToken),
    enabled: isAddress(activeToken),
    retry: false,
  });
  const configuredFee = activeToken.toLowerCase() === token?.toLowerCase() ? poolFee ?? tokenDetails.data?.token.fee : tokenDetails.data?.token.fee;
  const configuredHook = activeToken.toLowerCase() === token?.toLowerCase() ? poolHook ?? tokenDetails.data?.token.hook : tokenDetails.data?.token.hook;
  const parsedAmount = useMemo(() => {
    if (!amount || !Number.isFinite(Number(amount)) || Number(amount) <= 0) return undefined;
    try {
      const parsed = parseEther(amount);
      return parsed > 0n && parsed <= MAX_SIGNED_INT128 ? parsed : undefined;
    } catch {
      return undefined;
    }
  }, [amount]);
  useEffect(() => {
    if (initialDirection) setDirection(initialDirection);
  }, [initialDirection]);
  const slippageValue = Number(slippage);
  const slippageValid = Number.isFinite(slippageValue) && slippageValue >= 0.1 && slippageValue <= 50;
  const slippageBps = slippageValid ? Math.round(slippageValue * 100) : 0;
  const poolKey = useMemo(() => {
    if (!isAddress(activeToken) || configuredFee === undefined || configuredHook === undefined || !isAddress(configuredHook)) return undefined;
    if (!Number.isInteger(configuredFee) || configuredFee < 0 || configuredFee > 0xffffff) return undefined;
    return buildPoolKey(activeToken, configuredFee, configuredHook);
  }, [activeToken, configuredFee, configuredHook]);

  const quote = useQuery({
    queryKey: ["v4-quote", activeToken, configuredFee, configuredHook, direction, parsedAmount?.toString()],
    queryFn: async () => {
      if (!publicClient || !poolKey || !parsedAmount || !V4_QUOTER) throw new Error("Quote configuration is incomplete.");
      const result = await publicClient.simulateContract({
        address: V4_QUOTER,
        abi: v4QuoterAbi,
        functionName: "quoteExactInputSingle",
        args: [{ poolKey, zeroForOne: direction === "buy", exactAmount: parsedAmount, hookData: "0x" }],
        account: address,
      });
      return result.result[0];
    },
    enabled: Boolean(publicClient && poolKey && parsedAmount && slippageValid),
    retry: false,
    staleTime: 0,
  });
  const minimumOutput = quote.data === undefined || !slippageValid ? undefined : (quote.data * BigInt(10_000 - slippageBps)) / 10_000n;

  const sellAuthorization = useQuery({
    queryKey: ["sell-authorization", address, activeToken, V4_ROUTER],
    queryFn: async () => {
      if (!publicClient || !address || !isAddress(activeToken) || !V4_ROUTER) throw new Error("Authorization check is unavailable.");
      const [tokenAllowance, permitAllowance] = await Promise.all([
        publicClient.readContract({
          address: activeToken,
          abi: tokenApprovalAbi,
          functionName: "allowance",
          args: [address, PERMIT2],
        }),
        publicClient.readContract({
          address: PERMIT2,
          abi: permit2Abi,
          functionName: "allowance",
          args: [address, activeToken, V4_ROUTER],
        }),
      ]);
      return { tokenAllowance, permitAmount: permitAllowance[0], expiration: permitAllowance[1] };
    },
    enabled: Boolean(isConnected && publicClient && isAddress(activeToken) && V4_ROUTER),
    retry: false,
  });
  const sellAuthorized = Boolean(
    parsedAmount && sellAuthorization.data &&
      sellAuthorization.data.tokenAllowance >= parsedAmount &&
      sellAuthorization.data.permitAmount >= parsedAmount &&
      sellAuthorization.data.expiration > BigInt(Math.floor(Date.now() / 1000)),
  );

  const swapCall = useMemo(() => {
    if (!isAddress(activeToken) || !isAddress(recipient) || !parsedAmount || minimumOutput === undefined || configuredFee === undefined || configuredHook === undefined || !isAddress(configuredHook)) return null;

    try {
      return buildUniversalRouterExactInputSingle(
        activeToken,
        configuredFee,
        direction,
        parsedAmount,
        minimumOutput,
        recipient,
        configuredHook,
      );
    } catch {
      return null;
    }
  }, [activeToken, configuredFee, configuredHook, direction, minimumOutput, parsedAmount, recipient]);

  const { writeContractAsync, isPending, error } = useWriteContract();
  const receipt = useWaitForTransactionReceipt({ hash: transactionHash });
  const canSubmit = Boolean(routerReady && isConnected && swapCall && (direction === "buy" || sellAuthorized));
  const canAuthorize = Boolean(
    routerReady && isConnected && direction === "sell" && publicClient && swapCall && isAddress(activeToken) && sellAuthorization.isFetched && !sellAuthorized,
  );

  async function authorizeToken() {
    if (!address || !publicClient || !V4_ROUTER || !isAddress(activeToken) || !amount) return;
    setApprovalPending(true);
    setApprovalMessage("");
    setApprovalError("");

    try {
      const requiredAmount = parseEther(amount);
      const tokenAllowance = await publicClient.readContract({
        address: activeToken,
        abi: tokenApprovalAbi,
        functionName: "allowance",
        args: [address, PERMIT2],
      });

      if (tokenAllowance < requiredAmount) {
        const hash = await writeContractAsync({
          address: activeToken,
          abi: tokenApprovalAbi,
          functionName: "approve",
          args: [PERMIT2, MAX_UINT256],
        });
        await publicClient.waitForTransactionReceipt({ hash });
      }

      const [permitAmount, expiration] = await publicClient.readContract({
        address: PERMIT2,
        abi: permit2Abi,
        functionName: "allowance",
        args: [address, activeToken, V4_ROUTER],
      });
      const desiredExpiration = BigInt(Math.floor(Date.now() / 1000) + 86_400);

      if (permitAmount < requiredAmount || expiration < desiredExpiration) {
        const hash = await writeContractAsync({
          address: PERMIT2,
          abi: permit2Abi,
          functionName: "approve",
          args: [activeToken, V4_ROUTER, MAX_UINT160, Number(MAX_UINT48)],
        });
        await publicClient.waitForTransactionReceipt({ hash });
      }

      setApprovalMessage("Token and Permit2 approvals are set. Later sells of this token will not ask again unless an allowance expires or is revoked.");
      await sellAuthorization.refetch();
    } catch (e) {
      setApprovalError(friendlyError(e));
    } finally {
      setApprovalPending(false);
    }
  }

  async function submit() {
    if (!swapCall || !V4_ROUTER) return;
    try {
      setTransactionHash(undefined);
      const hash = await writeContractAsync({
        address: V4_ROUTER,
        abi: universalRouterAbi,
        functionName: "execute",
        args: [swapCall.commands, swapCall.inputs],
        value: swapCall.value,
      });
      setTransactionHash(hash);
    } catch {
      return;
    }
  }

  function applyBalancePercent(percent: 25 | 50 | 75 | "max") {
    const balance = payBalance.data;
    if (!balance) return;
    const value = percent === "max" ? balance.value : balance.value * BigInt(percent) / 100n;
    setAmount(formatUnits(value, balance.decimals));
  }

  return (
    <section className="swap-widget">
      <div className="panel swap-panel" style={{ "--token-hue": activeTokenHue } as React.CSSProperties}>
        <span className="swap-token-watermark" aria-hidden="true">{(tokenDetails.data?.token.symbol ?? tokenSymbol ?? "S").slice(0, 1).toUpperCase()}</span>
        {/*<header className="swap-title-block">
          <span>{tokenDetails.data?.token.name ?? tokenSymbol ?? "Token"}</span>
          <h2>{direction === "buy" ? "Buy" : "Sell"} {tokenDetails.data?.token.symbol ?? tokenSymbol ?? "token"}</h2>
          <p>Trade directly through this token&apos;s Uniswap V4 pool.</p>
        </header>*/}

        <div className="swap-mode-switch" role="group" aria-label="Swap mode">
          <button type="button" aria-pressed={direction === "buy"} className={direction === "buy" ? "active" : ""} onClick={() => { setDirection("buy"); setApprovalMessage(""); }}>Buy</button>
          <button type="button" aria-pressed={direction === "sell"} className={direction === "sell" ? "active" : ""} onClick={() => { setDirection("sell"); setApprovalMessage(""); }}>Sell</button>
        </div>

        <div className="swap-side swap-pay-side">
          <div className="swap-side-heading"><label htmlFor="amount">Pay</label></div>
          <div className="swap-input-row">
            <input id="amount" className="swap-amount" type="number" min="0" step="any" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0" />
            {direction === "buy" ? <span className="asset-chip"><span className="eth-mark">Ξ</span> ETH</span> : (
              <select aria-label="Token to sell" className="asset-select" value={activeToken} onChange={(event) => { setSelectedToken(event.target.value); setApprovalMessage(""); }}>
                {tokens.data?.map((item) => <option key={item.address} value={item.address}>{item.symbol}</option>)}
                {!tokens.data?.some((item) => item.address.toLowerCase() === activeToken.toLowerCase()) && activeToken && <option value={activeToken}>{tokenSymbol ?? "Selected token"}</option>}
              </select>
            )}
          </div>
          <div className="swap-percent-options" aria-label="Set amount from wallet balance">
            {([25, 50, 75, "max"] as const).map((percent) => <button key={percent} type="button" disabled={!payBalance.data || payBalance.data.value === 0n} onClick={() => applyBalancePercent(percent)}>{percent === "max" ? "Max" : `${percent}%`}</button>)}
          </div>
        </div>

        <div className="swap-receive">
          <span>You receive</span>
          <div>
            <output className="swap-output" aria-live="polite">{quote.data === undefined ? "0" : formatEther(quote.data)}</output>
            <strong>{direction === "buy" ? tokenDetails.data?.token.symbol ?? tokenSymbol ?? "TOKEN" : "ETH"}</strong>
          </div>
          {quote.isFetching && <small>Updating quote…</small>}
        </div>

        <div className="swap-settings">
          <label htmlFor="slippage">Slippage</label>
          <div className="swap-slippage"><input id="slippage" type="number" min="0.1" max="50" step="0.1" value={slippage} aria-invalid={!slippageValid} onChange={(event) => setSlippage(event.target.value)} /><span>%</span></div>
          {/*minimumOutput !== undefined && <span className="minimum-output">Min. received {formatEther(minimumOutput)} {direction === "buy" ? tokenDetails.data?.token.symbol ?? tokenSymbol ?? "tokens" : "ETH"}</span>*/}
        </div>

        {!routerConfigured && <p className="note bad">Universal Router is not configured for this network.</p>}
        {!isConnected && <p className="note">Connect your wallet on {chain.name} to begin.</p>}
        {isConnected && !correctNetwork && <p className="note bad">Switch your wallet to {chain.name} to swap.</p>}
        {direction === "sell" && isConnected && sellAuthorization.isLoading && <p className="note">Checking existing token approvals…</p>}
        {direction === "sell" && sellAuthorized && <p className="note ok">Token and Permit2 approvals are set for this token.</p>}
        {direction === "sell" && isConnected && sellAuthorization.isError && <p className="note bad">Could not check existing approvals: {(sellAuthorization.error as Error).message}</p>}
        {direction === "sell" && isConnected && sellAuthorization.isFetched && !sellAuthorized && <p className="note">First-time setup may require an ERC-20 approval to Permit2 and a Permit2 approval to the router. Existing approvals are checked and never repeated unnecessarily.</p>}
        {!activeToken && <p className="note">Select a token to see its live quote.</p>}
        {tokens.error && <p className="note bad">Could not load token list: {(tokens.error as Error).message}</p>}
        {tokenDetails.isLoading && <p className="note">Loading this token&apos;s pool settings…</p>}
        {tokenDetails.error && <p className="note bad">{(tokenDetails.error as Error).message}</p>}
        {quote.isFetching && <p className="note">Updating quote…</p>}
        {quote.error && <p className="note bad">Quote unavailable: {(quote.error as Error).message}</p>}

        <div className="actions">
          {canAuthorize && (
            <button disabled={approvalPending || isPending} onClick={authorizeToken}>
              {approvalPending ? "Confirm approvals in wallet…" : `Authorize ${tokenDetails.data?.token.symbol ?? tokenSymbol ?? "token"} once`}
            </button>
          )}
          {!canAuthorize && canSubmit ? (
            <button disabled={isPending || approvalPending || quote.isFetching || !slippageValid || !quote.data} onClick={submit}>
              {isPending ? "Confirm in wallet…" : direction === "buy" ? `Buy ${tokenDetails.data?.token.symbol ?? tokenSymbol ?? "token"}` : `Sell ${tokenDetails.data?.token.symbol ?? tokenSymbol ?? "token"}`}
            </button>
          ) : !canAuthorize && (
            <button disabled>{direction === "sell" && sellAuthorization.isLoading ? "Checking approvals…" : "Swap unavailable"}</button>
          )}
        </div>

        {approvalMessage && <p className="note">{approvalMessage}</p>}
        {approvalError && <p className="note bad">{approvalError}</p>}
        {error && <p className="note bad">{friendlyError(error)}</p>}
        {receipt.isLoading && <p className="note">Waiting for transaction confirmation…</p>}
        {receipt.isSuccess && transactionHash && (
          <p className="note"><a href={`${chain.blockExplorers.default.url}/tx/${transactionHash}`} target="_blank" rel="noreferrer">Swap confirmed</a></p>
        )}
      </div>
    </section>
  );
}
