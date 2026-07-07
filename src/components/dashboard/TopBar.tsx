import { getSession } from "@/lib/auth/config";
import { UserDropdown } from "./UserDropdown";

export async function TopBar() {
  const session = await getSession();
  const name = session?.user?.name ?? "Unknown";
  const email = session?.user?.email ?? "";
  const role = (session?.user as { role?: string } | undefined)?.role ?? "viewer";

  return (
    <header className="flex h-14 items-center justify-between border-b border-white/10 bg-[#1A365D] px-4 sm:px-6">
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold text-white/80 tracking-wide uppercase">
          CMDLY
        </span>
      </div>
      <UserDropdown name={name} email={email} role={role} />
    </header>
  );
}
