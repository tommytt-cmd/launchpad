"use client";
import { Header } from "@/components/Header";
import { LaunchForm } from "@/components/LaunchForm";
import { CONFIGURED } from "@/lib/config";

export default function LaunchPage() {
  return (
    <>
      <Header />
      <main>
        {!CONFIGURED && (
          <div className="banner">Not configured: copy .env.example to .env.local and set the chain and factory address.</div>
        )}
        <LaunchForm />
      </main>
    </>
  );
}