import { createFileRoute } from "@tanstack/react-router";
import { TokenList } from "@/components/TokenList";

export const Route = createFileRoute("/")({ component: HomePage });

function HomePage() {
  return (
    <main className="market-home-main">
      <TokenList />
    </main>
  );
}
