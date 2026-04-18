"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import {
  BookOpen,
  ChevronRight,
  LayoutDashboard,
  Users,
  HelpCircle,
  ClipboardList,
  GraduationCap,
  LogOut,
  PlusCircle,
  UsersRound,
  BarChart3,
} from "lucide-react";
import { NotificationBell } from "@/components/ui/notification-bell";
import { cn } from "@/lib/utils";
import { useTheme, type Theme } from "@/lib/theme";

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  roles?: string[];
};

const navItems: NavItem[] = [
  { href: "/dashboard",     label: "Dashboard",    icon: LayoutDashboard },
  { href: "/courses",       label: "Courses",       icon: BookOpen },
  { href: "/my-courses",    label: "My Courses",    icon: GraduationCap, roles: ["STUDENT"] },
  { href: "/question-bank", label: "Question Bank", icon: HelpCircle,     roles: ["INSTRUCTOR", "ADMIN"] },
  { href: "/grades",        label: "Grades",        icon: ClipboardList },
  { href: "/reports",       label: "Reports",       icon: BarChart3,      roles: ["INSTRUCTOR", "MANAGER", "ADMIN"] },
  { href: "/admin/users",   label: "Users",         icon: Users,          roles: ["ADMIN"] },
  { href: "/admin/cohorts", label: "Cohorts",       icon: UsersRound,     roles: ["ADMIN"] },
];

const themes: { id: Theme; label: string; swatch: string; accent: string }[] = [
  { id: "editorial", label: "Editorial", swatch: "#111111", accent: "#ff6a00" },
  { id: "organic",   label: "Organic",   swatch: "#DF4826", accent: "#0E1A58" },
];

export function Sidebar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { data: session } = useSession();
  const role = (session?.user as { role?: string })?.role ?? "STUDENT";
  const { theme, setTheme } = useTheme();
  const inCoursesSection = pathname === "/courses" || pathname.startsWith("/courses/");
  const courseStatus = searchParams.get("status");
  const visible = navItems.filter((item) => !item.roles || item.roles.includes(role));
  const canAuthorCourses = role === "INSTRUCTOR" || role === "ADMIN";
  const coursesSubnav = [
    { href: "/courses", label: "All Courses", active: pathname === "/courses" && !courseStatus },
    { href: "/courses?status=DRAFT", label: "Drafts", active: pathname === "/courses" && courseStatus === "DRAFT" },
    { href: "/courses?status=PUBLISHED", label: "Published", active: pathname === "/courses" && courseStatus === "PUBLISHED" },
    { href: "/courses?status=ARCHIVED", label: "Archived", active: pathname === "/courses" && courseStatus === "ARCHIVED" },
    ...(canAuthorCourses ? [{ href: "/courses/new", label: "New Course", active: pathname === "/courses/new" }] : []),
  ];

  return (
    <aside
      className="w-64 flex-shrink-0 flex flex-col h-screen sticky top-0"
      style={{ background: "var(--c-sidebar)" }}
    >
      {/* Brand */}
      <div className="p-5 border-b border-white/8">
        <Link href="/dashboard" className="flex items-center gap-2.5">
          <svg width="22" height="26" viewBox="0 0 24 28" fill="none" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
            {/* SALT — libra arch (top) */}
            <line x1="2"    y1="5.5"  x2="8.5"  y2="5.5"  stroke="var(--c-accent)" strokeWidth="1.5" />
            <line x1="15.5" y1="5.5"  x2="22"   y2="5.5"  stroke="var(--c-accent)" strokeWidth="1.5" />
            <path d="M 8.5,5.5 A 3.5,3 0 0,1 15.5,5.5" stroke="var(--c-accent)" strokeWidth="1.5" fill="none" />
            <circle cx="12" cy="2.8" r="1" stroke="var(--c-accent)" strokeWidth="1.5" fill="none" />
            {/* Upper double bar */}
            <line x1="2.5"  y1="7.5"  x2="21.5" y2="7.5"  stroke="var(--c-accent)" strokeWidth="1.5" />
            <line x1="2.5"  y1="9"    x2="21.5" y2="9"    stroke="var(--c-accent)" strokeWidth="1.5" />
            {/* Center vertical stem */}
            <line x1="12"   y1="5.5"  x2="12"   y2="26"   stroke="var(--c-accent)" strokeWidth="1.5" />
            {/* SULFUR — upward triangle + vertical axis + shared crossbar */}
            <path d="M 5.5,11.5 L 2,17.5 L 9,17.5 Z" stroke="var(--c-accent)" strokeWidth="1.5" fill="none" />
            <line x1="5.5"  y1="11.5" x2="5.5"  y2="25.5" stroke="var(--c-accent)" strokeWidth="1.5" />
            {/* Shared horizontal — sulfur crossbar / salt equator / mercury crossbar */}
            <line x1="1.5"  y1="19.5" x2="22.5" y2="19.5" stroke="var(--c-accent)" strokeWidth="1.5" />
            {/* SALT — circled cross (circle centred on shared bar) */}
            <circle cx="12" cy="19.5" r="3.5" stroke="var(--c-accent)" strokeWidth="1.5" fill="none" />
            {/* MERCURY — crescent horns + circle + vertical */}
            <path d="M 17.2,14 Q 19,11.8 20.8,14" stroke="var(--c-accent)" strokeWidth="1.5" fill="none" />
            <circle cx="19" cy="16"   r="2"   stroke="var(--c-accent)" strokeWidth="1.5" fill="none" />
            <line x1="19"   y1="18"   x2="19"  y2="25.5" stroke="var(--c-accent)" strokeWidth="1.5" />
            {/* Bottom double bar */}
            <line x1="1.5"  y1="25"   x2="22.5" y2="25"  stroke="var(--c-accent)" strokeWidth="1.5" />
            <line x1="1.5"  y1="26.5" x2="22.5" y2="26.5" stroke="var(--c-accent)" strokeWidth="1.5" />
          </svg>
          <span className="font-black text-lg tracking-tight text-white">MasteryOps</span>
        </Link>
      </div>

      {/* Nav */}
      <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
        {visible.map((item) => {
          const Icon = item.icon;
          const active =
            pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <div key={item.href}>
              <Link
                href={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all",
                  active
                    ? "text-white bg-white/8 border-l-2 pl-[10px]"
                    : "text-white/50 hover:text-white border-l-2 border-transparent pl-[10px]",
                )}
                style={active ? { borderLeftColor: "var(--c-accent)" } : undefined}
              >
                <Icon
                  className="h-4 w-4 shrink-0"
                  style={active ? { color: "var(--c-accent)" } : undefined}
                />
                {item.label}
              </Link>

              {item.href === "/courses" && inCoursesSection && (
                <div className="mt-1 ml-6 space-y-0.5">
                  {coursesSubnav.map((subItem) => (
                    <Link
                      key={subItem.href}
                      href={subItem.href}
                      className={cn(
                        "flex items-center gap-2 rounded-md px-3 py-2 text-xs transition-all",
                        subItem.active
                          ? "text-white bg-white/8"
                          : "text-white/40 hover:text-white/70 hover:bg-white/5"
                      )}
                    >
                      <ChevronRight
                        className="h-3 w-3 shrink-0"
                        style={subItem.active ? { color: "var(--c-accent)" } : undefined}
                      />
                      {subItem.label}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* User + theme switcher */}
      <div className="p-3 border-t border-white/8 space-y-2">
        {/* Theme switcher */}
        <div className="flex items-center gap-1.5 px-3 py-1">
          {themes.map((t) => (
            <button
              key={t.id}
              onClick={() => setTheme(t.id)}
              title={t.label}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-all",
                t.id === "organic" && "font-serif tracking-wide",
                theme === t.id
                  ? "bg-white/10 text-white"
                  : "text-white/30 hover:text-white/60",
              )}
            >
              {/* Mini dual-swatch */}
              <span className="flex rounded-sm overflow-hidden h-3 w-5 shrink-0">
                <span className="flex-1" style={{ background: t.swatch }} />
                <span className="flex-1" style={{ background: t.accent }} />
              </span>
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 px-3 py-2">
          <div className="h-8 w-8 rounded-full bg-white/10 flex items-center justify-center text-white font-semibold text-sm shrink-0">
            {session?.user?.name?.[0]?.toUpperCase() ?? "?"}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-white truncate">{session?.user?.name}</p>
            <p className="text-xs text-white/40 capitalize">{role.toLowerCase()}</p>
          </div>
          <NotificationBell />
        </div>
        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-white/40 hover:text-white hover:bg-white/5 transition-colors"
        >
          <LogOut className="h-4 w-4 shrink-0" />
          Sign out
        </button>
      </div>
    </aside>
  );
}
