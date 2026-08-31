"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { LogOut, Menu, Moon, Search, Sun, X } from "lucide-react";
import { useTheme } from "next-themes";
import { useAuth } from "@/components/auth/auth-provider";
import { Brand, NavLinks } from "@/components/layout/sidebar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { t } from "@/lib/strings";
import { initials } from "@/lib/utils";

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={t.nav.toggleTheme}
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
    >
      {mounted && resolvedTheme === "dark" ? (
        <Sun className="size-4" />
      ) : (
        <Moon className="size-4" />
      )}
    </Button>
  );
}

export function Header() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");

  function submitSearch(e: React.FormEvent) {
    e.preventDefault();
    const q = search.trim();
    router.push(q ? `/negociacoes?q=${encodeURIComponent(q)}` : "/negociacoes");
  }

  return (
    <>
      <header className="sticky top-0 z-40 flex h-12 items-center gap-3 border-b bg-background/90 px-4 backdrop-blur">
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden"
          aria-label={t.nav.openMenu}
          onClick={() => setMobileOpen(true)}
        >
          <Menu className="size-5" />
        </Button>

        <form
          onSubmit={submitSearch}
          role="search"
          className="relative hidden max-w-sm flex-1 sm:block"
        >
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t.kanban.filters.searchPlaceholder}
            className="h-8 border-transparent bg-muted/70 pl-8 text-[13px] shadow-none transition-colors duration-150 hover:bg-muted focus-visible:border-input focus-visible:bg-card"
            aria-label={t.common.search}
          />
        </form>

        <div className="ml-auto flex items-center gap-1">
          <ThemeToggle />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className="gap-2 px-2"
                aria-label={t.nav.myAccount}
              >
                <span className="flex size-6.5 items-center justify-center rounded-full bg-primary/15 text-[11px] font-semibold text-accent-foreground ring-1 ring-inset ring-primary/25">
                  {user ? initials(user.name) : "?"}
                </span>
                <span className="hidden text-sm font-medium sm:inline">
                  {user?.name}
                </span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel className="font-normal">
                <div className="text-sm font-medium">{user?.name}</div>
                <div className="text-xs text-muted-foreground">
                  {user?.email}
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => {
                  void logout();
                }}
              >
                <LogOut />
                {t.auth.logout}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {/* Mobile navigation overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            aria-label={t.common.close}
            className="absolute inset-0 bg-black/50"
            onClick={() => setMobileOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 flex w-64 flex-col gap-6 bg-sidebar p-4 shadow-xl">
            <div className="flex items-center justify-between">
              <Brand />
              <Button
                variant="ghost"
                size="icon"
                aria-label={t.common.close}
                onClick={() => setMobileOpen(false)}
              >
                <X className="size-5" />
              </Button>
            </div>
            <NavLinks onNavigate={() => setMobileOpen(false)} />
          </div>
        </div>
      )}
    </>
  );
}
