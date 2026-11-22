import { createFileRoute } from "@tanstack/react-router";
import { TokenDetail } from "@/components/TokenDetail";

export const Route = createFileRoute("/tiles/$address")({ component: TilesRoute });

function TilesRoute() {
  const { address } = Route.useParams();
  return (
    <main>
      {/^(0x)?[0-9a-fA-F]{40}$/.test(address)
        ? <TokenDetail address={address.startsWith("0x") ? address.toLowerCase() : `0x${address.toLowerCase()}`} initialTab="tiles" />
        : <p className="note bad">That isn&apos;t a valid token address.</p>}
    </main>
  );
}
