"use client";
import { useParams } from "next/navigation";
import { Header } from "@/components/Header";
import { TokenDetail } from "@/components/TokenDetail";

export default function TokenPage() {
  const { address } = useParams<{ address: string }>();
  return (
    <>
      <Header />
      <main>{/^0x[0-9a-fA-F]{40}$/.test(address) ? <TokenDetail address={address.toLowerCase()} /> : <p className="note bad">That isn&apos;t a valid token address.</p>}</main>
    </>
  );
}
