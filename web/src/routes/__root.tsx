import { createRootRoute, Outlet } from "@tanstack/react-router";
import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";
import { Providers } from "@/providers";

function RootLayout() {
  return (
    <Providers>
      <Header />
      <Outlet />
      <Footer />
    </Providers>
  );
}

export const Route = createRootRoute({
  component: RootLayout,
  notFoundComponent: () => <main><p className="note bad">Page not found.</p></main>,
});
