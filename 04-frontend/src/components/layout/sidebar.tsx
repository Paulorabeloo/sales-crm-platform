"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  CheckSquare,
  Kanban,
  Settings,
  Sun,
  Users,
} from "lucide-react";
import { useAuth } from "@/components/auth/auth-provider";
import { useRecoverableDeals } from "@/hooks/queries";
import { t } from "@/lib/strings";
import { cn } from "@/lib/utils";

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  adminOnly?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { href: "/meu-dia", label: t.nav.myDay, icon: Sun },
  { href: "/negociacoes", label: t.nav.deals, icon: Kanban },
  { href: "/tarefas", label: t.nav.tasks, icon: CheckSquare },
  { href: "/contatos", label: t.nav.contacts, icon: Users },
  { href: "/relatorios", label: t.nav.reports, icon: BarChart3, adminOnly: true },
  {
    href: "/configuracoes",
    label: t.nav.settings,
    icon: Settings,
    adminOnly: true,
  },
];

/** Geometric funnel monogram — three narrowing bars, drawn inline. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      aria-hidden
      className={cn("size-5 shrink-0 text-accent-foreground", className)}
      fill="currentColor"
    >
      <rect x="2" y="2.6" width="16" height="3.4" rx="1.7" />
      <rect x="4.6" y="8.3" width="10.8" height="3.4" rx="1.7" opacity="0.66" />
      <rect x="7.2" y="14" width="5.6" height="3.4" rx="1.7" opacity="0.38" />
    </svg>
  );
}

export function Brand() {
  return (
    <Link
      href="/negociacoes"
      className="flex items-center gap-2 rounded-md px-2 py-1 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <BrandMark />
      <span className="text-[15px] font-semibold leading-none tracking-tight">
        {t.app.name}
      </span>
    </Link>
  );
}

export function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { isAdmin } = useAuth();
  // Rescue badge: recoverable lost leads from previous cycles.
  const recoverable = useRecoverableDeals();
  const rescueCount = recoverable.data?.total ?? 0;

  return (
    <nav aria-label="Menu principal" className="flex flex-col gap-0.5">
      {NAV_ITEMS.filter((item) => !item.adminOnly || isAdmin).map((item) => {
        const active = pathname.startsWith(item.href);
        const Icon = item.icon;
        const showRescueBadge = item.href === "/meu-dia" && rescueCount > 0;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active
                ? "bg-accent font-medium text-accent-foreground"
                : "font-normal text-sidebar-foreground hover:bg-foreground/[0.045] hover:text-foreground",
            )}
          >
            <Icon
              className={cn(
                "size-4",
                active ? "text-accent-foreground" : "text-muted-foreground",
              )}
            />
            {item.label}
            {showRescueBadge && (
              <span
                title={t.rescue.title}
                className="tnum ml-auto rounded-full bg-warning/20 px-1.5 py-px text-[11px] font-semibold text-warning-foreground dark:bg-warning/25 dark:text-warning"
              >
                {rescueCount}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

export function Sidebar() {
  return (
    <aside className="hidden w-56 shrink-0 flex-col gap-5 border-r bg-sidebar px-3 py-4 md:flex">
      <Brand />
      <NavLinks />
    </aside>
  );
}
