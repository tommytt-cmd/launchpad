import { createFileRoute } from "@tanstack/react-router";
import { LaunchForm } from "@/components/LaunchForm";
import { CONFIGURED } from "@/lib/config";

export const Route = createFileRoute("/launch")({ component: LaunchPage });

function LaunchPage() {
  return (
    <main>
      {!CONFIGURED && (
        <div className="banner">Not configured: copy .env.example to .env.local and set the chain and factory address.</div>
      )}
      <LaunchForm />
    </main>
  );
}
