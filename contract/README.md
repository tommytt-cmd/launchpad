# Launchpad MVP (Uniswap V4)

A minimal token launchpad for a Uniswap V4 chain (target: Robinhood Chain).

**Status: UNAUDITED and NOT YET COMPILED.** These files were written without network
access, so the Uniswap libraries could not be installed and `forge build` has not been run.
Expect to fix small import-path or signature mismatches on first build. Do not deploy with
real funds until it compiles, the tests pass, and it has been professionally audited.

## What it does

One `launch()` transaction:

1. Deploys a fixed-supply token (1,000,000,000, minted once in the constructor, no mint function).
2. Opens a V4 pool: native ETH (currency0) / token (currency1), with a creator-chosen LP fee of 1%-5%.
3. Deposits the whole supply as single-sided liquidity, owned by the factory, with no removal path.
4. Makes the creator's initial buy (capped at 10% of supply), refunding any unused ETH.
5. Optionally attaches an approved hook (`AntiSnipeHook`: per-transaction buy cap during the first 5 minutes).

Fees: the LP fee accrues to the locked position. Anyone can call `harvest(token)`, which credits
70% to the creator and 30% to the platform. The creator calls `claim(token)` (anyone may trigger it;
funds go to the creator) only while their token balance is at or above their post-launch snapshot (hold-to-earn).

## Setup

Run these commands from the `contract/` directory after cloning. Foundry is required. The `lib/` directory is intentionally excluded from Git, so install dependencies locally. `--no-git` prevents Foundry from registering each dependency as a Git submodule.

```bash
forge --version
forge install --no-git Uniswap/v4-core
forge install --no-git Uniswap/v4-periphery
forge install --no-git Uniswap/v4-hooks-public
forge install --no-git OpenZeppelin/openzeppelin-contracts
forge install --no-git foundry-rs/forge-std
forge install --no-git solmate=transmissions11/solmate
forge install --no-git permit2=Uniswap/permit2
forge install --no-git v2-core=Uniswap/v2-core
forge install --no-git v3-core=Uniswap/v3-core
forge install --no-git v3-periphery=Uniswap/v3-periphery
forge install --no-git universal-router-v4=Uniswap/universal-router
forge build
forge test -vv
```

The install aliases match `remappings.txt`; if you change a dependency folder name, update the corresponding remapping too. The hook base comes from `v4-hooks-public`; `HookMiner` is imported from `v4-periphery/test/shared` in the current package layout. For reproducible builds, pin dependencies to reviewed tags or commits and commit the generated `foundry.lock` file. Use the same `v4-core` release that you deploy as the PoolManager.

Deploy:

```bash
export POOL_MANAGER=<official V4 PoolManager on the target chain>
export OWNER=<platform admin address>
forge script script/Deploy.s.sol --rpc-url $RPC --private-key $PK --broadcast
# then: factory.setHookApproved(<hook>, true)
```

Verify before deploying: the PoolManager address (use Uniswap's official deployment docs), that
the deterministic CREATE2 deployer `0x4e59...956C` exists on the chain, and the chain's RPC/chain ID.

## Design decisions

- **Native ETH quote only.** Native ETH is `address(0)`, which always sorts as currency0, so the token is
  always currency1. This removes ordering branches. Stablecoin/stock-token pairs are a later extension.
- **Virtual-reserve pricing.** The position spans [MIN_TICK, start tick], so it behaves like a constant-product
  pool whose virtual ETH reserve equals the chosen FDV. Buying 10% of supply costs about FDV / 9 in ETH.
- **Tick spacing 200.** Start price snaps to the nearest tick, up to ~2% off the requested valuation.
- **Trust gate for hooks.** `approvedHook` is owner-controlled. A hook sees every swap, and a malicious one
  could freeze trading or skim swaps, so only approve audited hooks.

## Known limitations (read these)

1. **Anti-snipe is weak.** The cap is per transaction; bots split buys across many transactions or wallets.
2. **Hold-to-earn is gameable.** A creator can borrow tokens briefly to pass the balance check, or hold the
   snapshot in a second wallet. Treat it as a speed bump.
3. **Protocol fees may reduce your 70/30.** Uniswap governance has been activating protocol fees on some V4
   pools. Check whether they apply to static-fee pools on your chain; your creator/platform split is of
   what remains after that.
4. **Fee currency.** V4 collects fees in the swap's input currency: buys pay fees in ETH, sells in the token.
   Both are escrowed separately (the creator receives ETH and tokens).
5. **Admin power.** The owner can change launch fee, FDV bounds, and approved hooks. The owner cannot touch
   locked liquidity or creator escrow. Never add a function that calls `modifyLiquidity` with a negative delta.
6. **Not included:** reflections, burn/buyback modules, vesting, scheduled launches, fee splits across several
   wallets, stock-token pairs, metadata storage beyond the `Launched` event, and a frontend/indexer.

## Layout

- `src/LaunchToken.sol`: fixed-supply ERC-20
- `src/LaunchFactory.sol`: launch, lock, harvest, claim, admin
- `src/AntiSnipeHook.sol`: optional buy-cap hook
- `script/Deploy.s.sol`: deploy factory + mine hook address
- `test/Launch.t.sol`: launch, fee split, hold gate, anti-snipe tests
