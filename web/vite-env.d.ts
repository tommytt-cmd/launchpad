/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CHAIN_ID?: string;
  readonly VITE_CHAIN_NAME?: string;
  readonly VITE_RPC_URL?: string;
  readonly VITE_EXPLORER?: string;
  readonly VITE_FACTORY?: string;
  readonly VITE_ANTISNIPE_HOOK?: string;
  readonly VITE_POOL_MANAGER?: string;
  readonly VITE_V4_ROUTER?: string;
  readonly VITE_V4_QUOTER?: string;
  readonly VITE_PERMIT2?: string;
  readonly VITE_INDEXER_URL?: string;
  readonly NEXT_PUBLIC_CHAIN_ID?: string;
  readonly NEXT_PUBLIC_CHAIN_NAME?: string;
  readonly NEXT_PUBLIC_RPC_URL?: string;
  readonly NEXT_PUBLIC_EXPLORER?: string;
  readonly NEXT_PUBLIC_FACTORY?: string;
  readonly NEXT_PUBLIC_ANTISNIPE_HOOK?: string;
  readonly NEXT_PUBLIC_POOL_MANAGER?: string;
  readonly NEXT_PUBLIC_V4_ROUTER?: string;
  readonly NEXT_PUBLIC_V4_QUOTER?: string;
  readonly NEXT_PUBLIC_PERMIT2?: string;
  readonly NEXT_PUBLIC_INDEXER_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
