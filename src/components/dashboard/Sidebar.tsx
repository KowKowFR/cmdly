"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  LayoutDashboard,
  MessageSquare,
  Server,
  Bell,
  BarChart2,
  ClipboardList,
  Settings,
  Menu,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { label: "Dashboard", href: "/", icon: LayoutDashboard },
  { label: "Chat", href: "/chat", icon: MessageSquare },
  { label: "VMs", href: "/vms", icon: Server },
  { label: "Alerts", href: "/alerts", icon: Bell },
  { label: "Metrics", href: "/metrics", icon: BarChart2 },
  { label: "Audit", href: "/audit", icon: ClipboardList },
  { label: "Settings", href: "/settings", icon: Settings },
] as const;

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <>
      {/* Mobile toggle */}
      <button
        className="fixed top-4 left-4 z-50 md:hidden rounded-md p-2 bg-[#1A365D] text-white shadow"
        onClick={() => setCollapsed((prev) => !prev)}
        aria-label="Toggle navigation"
      >
        {collapsed ? <Menu size={18} /> : <X size={18} />}
      </button>

      <aside
        className={cn(
          "flex flex-col h-screen bg-[#1A365D] text-white transition-all duration-200",
          "fixed inset-y-0 left-0 z-40 md:relative md:translate-x-0",
          collapsed ? "-translate-x-full md:w-16" : "translate-x-0 w-60"
        )}
      >
        {/* Logo area */}
        <div className="flex items-center gap-3 px-4 py-5 border-b border-white/10">
          <img src="/logo.svg" alt="CMDLY" className="h-7 w-auto shrink-0" />
          {!collapsed && (
            <span className="text-lg font-bold tracking-wide text-white">
              CMDLY
            </span>
          )}
        </div>

        {/* Desktop collapse toggle */}
        <button
          className="hidden md:flex items-center justify-end px-3 py-2 text-white/40 hover:text-white/80 transition-colors"
          onClick={() => setCollapsed((prev) => !prev)}
          aria-label="Collapse sidebar"
        >
          {collapsed ? <Menu size={16} /> : <X size={16} />}
        </button>

        <nav className="flex-1 px-2 py-2 space-y-1 overflow-y-auto">
          {NAV_ITEMS.map(({ label, href, icon: Icon }) => {
            const active =
              href === "/" ? pathname === "/" : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "bg-[#DD6B20] text-white"
                    : "text-white/70 hover:bg-white/10 hover:text-white"
                )}
                title={collapsed ? label : undefined}
              >
                <Icon size={18} className="shrink-0" />
                {!collapsed && <span>{label}</span>}
              </Link>
            );
          })}
        </nav>
      </aside>

      {/* Mobile overlay */}
      {!collapsed && (
        <div
          className="fixed inset-0 z-30 bg-black/40 md:hidden"
          onClick={() => setCollapsed(true)}
        />
      )}
    </>
  );
}
