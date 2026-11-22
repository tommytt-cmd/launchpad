import { createFileRoute } from "@tanstack/react-router";
import { TokenList } from "@/components/TokenList";

export const Route = createFileRoute("/tokens")({ component: TokensPage });

function TokensPage() {
  return (
    <main>
      <TokenList />
    </main>
  );
}
