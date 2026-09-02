import { PublicHeader } from "@/components/navigation/public-header";

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-mist-50">
      <PublicHeader />
      {children}
    </div>
  );
}
