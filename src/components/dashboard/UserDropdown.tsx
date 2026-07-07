"use client";

import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth/client";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { LogOut } from "lucide-react";

interface Props {
  name: string;
  email: string;
  role: string;
}

export function UserDropdown({ name, email, role }: Props) {
  const router = useRouter();

  async function handleSignOut() {
    await authClient.signOut();
    router.push("/login");
  }

  const initials = name
    .split(" ")
    .map((n) => n[0] ?? "")
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <DropdownMenu>
      {/* Base UI Trigger renders as a <button> — style it directly */}
      <DropdownMenuTrigger
        className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-white/10 transition-colors outline-none"
        aria-label="User menu"
      >
        <Avatar className="h-7 w-7">
          <AvatarFallback className="text-xs bg-[#DD6B20] text-white">
            {initials}
          </AvatarFallback>
        </Avatar>
        <span className="text-sm font-medium text-white hidden sm:block">
          {name}
        </span>
        <Badge
          variant="secondary"
          className="text-xs hidden sm:inline-flex bg-white/20 text-white"
        >
          {role}
        </Badge>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel className="font-normal">
          <p className="text-sm font-medium">{name}</p>
          <p className="text-xs text-muted-foreground truncate">{email}</p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="text-destructive focus:text-destructive cursor-pointer"
          onClick={handleSignOut}
        >
          <LogOut size={14} className="mr-2" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
