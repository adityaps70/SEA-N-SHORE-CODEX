import { AppHeader } from "@/components/navigation/app-header";
import { MobileNav } from "@/components/navigation/mobile-nav";
import { requireUser } from "@/features/auth/queries";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireUser();
  return (
    <div className="min-h-screen bg-mist-50 pb-20 md:pb-0">
      <AppHeader />
      <main id="main-content" className="mx-auto w-full max-w-7xl px-4 py-6">
        {children}
      </main>
      <MobileNav />
    </div>
  );
}
