import { createFileRoute } from "@tanstack/react-router";
import { TokenDetail } from "@/components/TokenDetail";

export const Route = createFileRoute("/token/$address")({
  component: TokenRoute,
});

function TokenRoute() {
  const { address } = Route.useParams();
  return (
    <main style={{ paddingTop: "10px" }}>
      {/^0x[0-9a-fA-F]{40}$/.test(address)
        ? <TokenDetail address={address.toLowerCase()} />
        : <p className="note bad">That isn&apos;t a valid token address.</p>}
    </main>
  );
}
