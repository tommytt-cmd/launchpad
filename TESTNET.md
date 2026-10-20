# Robinhood Chain Testnet Deployment

This guide deploys an **unmodified Uniswap V4 `PoolManager` from upstream `v4-core` source** to Robinhood Chain Testnet, then deploys this launchpad against that manager. This creates a fresh, isolated V4 deployment; it does not copy Unichain pool state and it will not automatically appear in Uniswap's app or aggregators.

The launchpad is an unaudited prototype. Do not use real funds or deploy this version to mainnet.

## Network and contracts

| Setting | Value |
|---|---|
| Network | Robinhood Chain Testnet |
| Chain ID | `46630` |
| RPC | `https://rpc.testnet.chain.robinhood.com` |
| Explorer | `https://explorer.testnet.chain.robinhood.com` |
| Faucet | `https://faucet.testnet.chain.robinhood.com` |
| V4 PoolManager | You deploy it in Step 4; record its resulting address |

Reconfirm network details in Robinhood's current developer documentation before using them. Uniswap's official Unichain Sepolia PoolManager is for chain ID `1301`; do not use it on Robinhood Chain Testnet.

## 1. Install and check the project

Run commands from the `contract/` directory. Install Foundry if it is not already available, then install the Solidity dependencies and build/test locally. These commands use `--no-git` because this directory is not initialized as a Git repository; Foundry otherwise tries to add each dependency as a Git submodule.

```bash
forge --version
forge install --no-git Uniswap/v4-core
forge install --no-git Uniswap/v4-periphery
forge install --no-git Uniswap/v4-hooks-public
forge install --no-git OpenZeppelin/openzeppelin-contracts
forge install --no-git foundry-rs/forge-std
forge build
forge test -vv
```

The local test in `test/Launch.t.sol` deploys a temporary PoolManager using Uniswap's test utilities. Passing it checks local logic; it does not prove the Robinhood deployment will work. Fix build/test errors before broadcasting anything. Pin dependency versions to a reviewed release or commit before treating deployments as reproducible.

## 2. Create and fund a test wallet

Use a fresh wallet only for testnet work. Never put a mainnet private key in shell history, project files, or an `.env` file.

```bash
cast wallet import rh-testnet --interactive
```

Fund it from the testnet faucet. The wallet pays for deploying the PoolManager, factory, hook, and test transactions. Foundry's encrypted keystore keeps the key out of command arguments; use `--account rh-testnet` in the commands below.

## 3. Set network variables and verify the chain

```bash
export RPC=https://rpc.testnet.chain.robinhood.com
export OWNER=0x2c1af32165be28ccf4e94009522d08e6ccfcee2b
cast chain-id --rpc-url "$RPC"
cast balance "$OWNER" --rpc-url "$RPC"
```

The chain ID must be `46630`, and the wallet must have testnet ETH. Stop if either check fails.

## 4. Deploy and record the upstream V4 PoolManager

The current upstream `PoolManager` constructor takes one argument, `address initialOwner`. Deploy the source installed by `forge install`, not a copied or modified contract:

```bash
export RPC=https://rpc.testnet.chain.robinhood.com
: "${OWNER:?Set/export OWNER in this terminal using Step 3}"
test "$(cast chain-id --rpc-url https://rpc.testnet.chain.robinhood.com)" = 46630 || { echo "RPC is not Robinhood Chain Testnet"; exit 1; }
forge create \
  --rpc-url https://rpc.testnet.chain.robinhood.com \
  --account rh-testnet \
  --broadcast \
  lib/v4-core/src/PoolManager.sol:PoolManager \
  --constructor-args "$OWNER"
```

Copy the deployed address printed by Forge and set it for the remaining steps:

```bash
export POOL_MANAGER=0x62D81f7e973486e37cdC66ad5Af7114C6e542692
cast code "$POOL_MANAGER" --rpc-url "$RPC"
```

The `cast code` result must not be `0x`. Save the transaction hash and address. The `initialOwner` is the wallet set as `OWNER`; review V4 protocol-fee administration and decide how that owner key will be controlled, even on testnet.

## 5. Check the CREATE2 deployer needed by the hook script

`script/Deploy.s.sol` mines the `AntiSnipeHook` address using this hard-coded deployer address:

```text
0x4e59b44847b379578588920cA78FbF26c0B4956C
```

Check that the contract exists on Robinhood Chain Testnet:

```bash
cast code 0x4e59b44847b379578588920cA78FbF26c0B4956C --rpc-url "$RPC"
```

Do not assume a CREATE2 factory is available just because the network is EVM-compatible. If this returns `0x`, **stop before running `Deploy.s.sol`**: its mining/deployment path must be changed to use a CREATE2 deployment factory that is actually present and invoked by the script, or the factory and hook must be deployed separately with a compatible deployment flow. Merely changing the address passed to `HookMiner.find` is not enough unless the actual deployment uses that same factory.

## 6. Deploy the launch factory and anti-snipe hook

Only continue after the manager and required CREATE2 deployment path have been verified. Set the deployer wallet as `OWNER` for simplicity on testnet, then broadcast:

```bash
export RPC=https://rpc.testnet.chain.robinhood.com
export POOL_MANAGER=0x62D81f7e973486e37cdC66ad5Af7114C6e542692
export OWNER=0x2c1af32165be28ccf4e94009522d08e6ccfcee2b
forge script script/Deploy.s.sol \
  --rpc-url "$RPC" \
  --account rh-testnet \
  --sender "$OWNER" \
  --broadcast
```

The deployment completed successfully at block `131728589`:

| Contract | Address | Deployment transaction |
|---|---|---|
| LaunchFactory | `0xb40216a118954516D7D40Ad507728d08AC51BD85` | `0x19aaa8180fa9ef33395d811398d28d43ab04274cc4a724e525b78a12a2e6d5b0` |
| AntiSnipeHook | `0xF2875076a5ad187Cb9732f04864Cb6b94aa18040` | `0x95bbf23133a4395a4ac1279cf028db85e9bf0f5e87a61f6218e2a81833773f7a` |

The script deploys both contracts; it does not approve the hook automatically. Forge warned that Robinhood Testnet may not support EIP-3855 (`PUSH0`) for contracts compiled with Solidity 0.8.20 or newer. Basic getter calls succeeded, but that does not validate the V4 `unlock`/settlement path. Treat the first plain-pool `launch()` in Step 8 as a compatibility gate; do not assume deployment success alone proves V4 operations work.

Approve the hook from the factory owner account:

```bash
export FACTORY=0xb40216a118954516D7D40Ad507728d08AC51BD85
export HOOK=0xF2875076a5ad187Cb9732f04864Cb6b94aa18040
cast send "$FACTORY" "setHookApproved(address,bool)" "$HOOK" true \
  --rpc-url "$RPC" \
  --account rh-testnet
```

Confirm the transaction succeeds and `approvedHook(HOOK)` returns true:

```bash
cast call "$FACTORY" "approvedHook(address)(bool)" "$HOOK" --rpc-url "$RPC"
```

## 7. Verify deployed addresses and configuration

Confirm bytecode is present at the PoolManager, factory, and hook:

```bash
cast code "$POOL_MANAGER" --rpc-url "$RPC"
cast code "$FACTORY" --rpc-url "$RPC"
cast code "$HOOK" --rpc-url "$RPC"
```

Read back the factory's key settings:

```bash
cast call "$FACTORY" "poolManager()(address)" --rpc-url "$RPC"
cast call "$FACTORY" "owner()(address)" --rpc-url "$RPC"
cast call "$FACTORY" "launchFee()(uint256)" --rpc-url "$RPC"
cast call "$FACTORY" "minFdv()(uint256)" --rpc-url "$RPC"
cast call "$FACTORY" "maxFdv()(uint256)" --rpc-url "$RPC"
```

Compare the returned manager and owner addresses with the values you set. The PoolManager constructor also takes the initial owner, so its verification command includes the same `OWNER` value used in Step 3. To re-run Blockscout verification with the exact constructor arguments used in this deployment:

```bash
forge verify-contract \
  0x62D81f7e973486e37cdC66ad5Af7114C6e542692 \
  lib/v4-core/src/PoolManager.sol:PoolManager \
  --chain 46630 \
  --rpc-url https://rpc.testnet.chain.robinhood.com \
  --verifier blockscout \
  --verifier-url https://explorer.testnet.chain.robinhood.com/api/ \
  --constructor-args "$OWNER" \
  --watch

forge verify-contract \
  0xb40216a118954516D7D40Ad507728d08AC51BD85 \
  src/LaunchFactory.sol:LaunchFactory \
  --chain 46630 \
  --rpc-url https://rpc.testnet.chain.robinhood.com \
  --verifier blockscout \
  --verifier-url https://explorer.testnet.chain.robinhood.com/api/ \
  --constructor-args "$(cast abi-encode 'constructor(address,address)' 0x62D81f7e973486e37cdC66ad5Af7114C6e542692 0x2c1af32165be28ccf4e94009522d08e6ccfcee2b)" \
  --watch

forge verify-contract \
  0xF2875076a5ad187Cb9732f04864Cb6b94aa18040 \
  src/AntiSnipeHook.sol:AntiSnipeHook \
  --chain 46630 \
  --rpc-url https://rpc.testnet.chain.robinhood.com \
  --verifier blockscout \
  --verifier-url https://explorer.testnet.chain.robinhood.com/api/ \
  --constructor-args "$(cast abi-encode 'constructor(address,address)' 0x62D81f7e973486e37cdC66ad5Af7114C6e542692 0xb40216a118954516D7D40Ad507728d08AC51BD85)" \
  --watch
```

All three contracts have been verified successfully on Blockscout:

- [PoolManager](https://explorer.testnet.chain.robinhood.com/address/0x62d81f7e973486e37cdc66ad5af7114c6e542692)
- [LaunchFactory](https://explorer.testnet.chain.robinhood.com/address/0xb40216a118954516d7d40ad507728d08ac51bd85)
- [AntiSnipeHook](https://explorer.testnet.chain.robinhood.com/address/0xf2875076a5ad187cb9732f04864cb6b94aa18040)

The PoolManager was deployed from upstream source in Step 4; verify it separately if its explorer page does not show verified source.

## 8. Launch a test token

The factory's `launch` call creates the token, initializes its pool, adds the locked liquidity, and makes the creator's initial buy. For a first test, use the plain pool (`hook = address(0)`) to separate launch integration from hook deployment issues. The factory charges a `0.0004 ETH` launch fee. This smaller example sends `0.01 ETH` total, leaving a `0.0096 ETH` initial-buy budget and reserving the rest of a `0.0184 ETH` wallet for gas. If the gas estimate or fee reserve is still too high, get more testnet ETH from the faucet or reduce `--value` further while keeping it above `0.0004 ETH`.

```bash
cast send "$FACTORY" \
  "launch((string,string,string,uint256,uint24,address))" \
  '(Test Token,TEST,ipfs://example,10000000000000000000,30000,0x0000000000000000000000000000000000000000)' \
  --value 0.01ether \
  --rpc-url "$RPC" \
  --account rh-testnet
```

The example requests a 10 ETH FDV and a 3% pool fee. Check the receipt and explorer for the `Launched` event and record its token address. Confirm the transaction used the expected PoolManager and that the token supply is `1,000,000,000` tokens. If your `cast` version rejects the tuple argument syntax, use a small Foundry script calling `LaunchFactory.launch` with the same `LaunchParams` values instead.

For the anti-snipe path, repeat with the deployed, approved `$HOOK` as the final tuple argument. The hook's buy cap begins after the creator's initial buy and only applies for its first five minutes.

## 9. Deploy and test the Universal Router

The project deploys the V4-capable Uniswap Universal Router from pinned upstream revision `543e1a19d6e21e31ced2512eec5792b50f13a0ba`, configured to use the PoolManager from Step 4. The canonical Permit2 contract is already present on this testnet at `0x000000000022D473030F116dDEE9F6B43aC78BA3`.

The testnet does not have the Robinhood mainnet WETH, V2/V3 factories, or position managers. The deployment script maps those optional features to an `UnsupportedProtocol` stub. Native ETH V4 swaps and Permit2 ERC-20 settlement are enabled; WETH wrapping, V2/V3 swaps, and position-manager commands are not.

```bash
export POOL_MANAGER=0x62D81f7e973486e37cdC66ad5Af7114C6e542692
forge script script/DeployUniversalRouter.s.sol:DeployLaunchpadUniversalRouter \
  --rpc-url "$RPC" \
  --account rh-testnet \
  --sender "$OWNER" \
  --broadcast
```

The test deployment is:

| Contract | Address | Deployment transaction |
|---|---|---|
| UniversalRouter | `0x8AC91Ab2b7aF520Db706CADc78FD79DaB8F467dB` | `0x785ef01843b530990eeeb3eb054dad24981b194848d57f61da9f60f9e7cc9104` |
| UnsupportedProtocol | `0xa25f7d278012d9F255B6C978DD57e70a37a395C2` | `0x4e0fcce78cca420c6840bd6abebd3beeac0250048000307053487bd9083b5b71` |

The frontend reads `NEXT_PUBLIC_V4_ROUTER` and `NEXT_PUBLIC_PERMIT2` from `web/.env.local`. The V4 pool key must match the launch: native ETH is currency0, the token is currency1, with the launch fee, tick spacing `200`, and the pool's actual hook address.

Both directions were exercised against token `0x11c7Fa6cc434C668Cf14b6003d751EfbAb8d88AE`:

- Buy: `0.0001 ETH` returned `9,666.400166245104151532` tokens; transaction `0x82885d228ef09f80bbaa2f214869297dbc4291a521ca447b92032aca3bada403`.
- Sell: `100` tokens were sold with a `0.0000005 ETH` minimum; transaction `0xb66a92f107272267b5e63058d746e37c32bcbcdd9845e669b1ea976d190b0d4a`.

For token sells, the wallet must first approve Permit2 from the token contract, then approve the Universal Router as a spender in Permit2. The web swap panel provides an `Authorize token` action for these two approvals. The Robinhood RPC reports EIP-3855 as unsupported, but these live V4 router transactions succeeded; continue treating this as testnet-only until the network's opcode support and full integration are independently validated.

## 10. Understand the limits of this test

- This is an isolated V4 deployment on Robinhood testnet. Its pools and assets are separate from Unichain and Robinhood mainnet.
- The Universal Router deployment is configured only for this custom PoolManager and native/token V4 swaps. Optional V2/V3, WETH, position-manager, and bridging paths are disabled on this testnet deployment.
- Once test swaps have generated fees, call `harvest(token)` and then `claim(token)` while the creator still meets the hold-to-earn balance gate. Test both ETH-side and token-side fee behavior before relying on it.
- Passing tests here establishes behavior against the upstream source version you deployed, not that Robinhood operates or supports this PoolManager deployment.
- A fresh deployment has no existing pools, liquidity, integrations, or Uniswap app visibility.

## 11. Before using real funds

- Compile and run all local tests from a clean checkout with pinned dependencies.
- Test launch with and without the hook, bounds/revert cases, fee collection, claims, and failed ETH/token transfers.
- Verify dependency versions, deployment bytecode, constructor arguments, owner permissions, CREATE2 address derivation, and deployed hook permission bits.
- Obtain an independent security audit. This code is explicitly unaudited and should not be used for a mainnet launch without review.