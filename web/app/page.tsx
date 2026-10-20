import { Header } from "@/components/Header";
import { TokenList } from "@/components/TokenList";

export default function Page() {
  return (
    <>
      <Header />
      <main className="market-home-main">
        <TokenList />
      </main>
    </>
  );
}
