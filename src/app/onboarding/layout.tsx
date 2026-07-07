export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#0D1B2A] text-white flex items-center justify-center p-4">
      {children}
    </div>
  );
}
