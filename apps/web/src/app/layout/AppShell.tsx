import { Moon, Plus, Sun, SunMoon } from 'lucide-react';
import { motion } from 'motion/react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { BrandMark } from '@/components/brand-mark';
import { Button, buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { todayKey } from '@/lib/dates';
import { useTheme, type ThemePreference } from '@/lib/theme';
import { NAV_ITEMS } from './nav';

/**
 * Responsive frame: a left sidebar from `lg` up, a bottom tab bar below. Pages render in <main>
 * with room reserved for the tab bar so content is never hidden behind it.
 */
export function AppShell() {
  return (
    <div className="min-h-dvh lg:flex">
      <Sidebar />
      <main
        id="main"
        className="pt-safe gutter lg:gutter-lg mx-auto w-full max-w-[75rem] flex-1 pb-[calc(5.25rem+env(safe-area-inset-bottom))] lg:pb-10"
      >
        <Outlet />
      </main>
      <TabBar />
    </div>
  );
}

function Sidebar() {
  const location = useLocation();
  return (
    <aside className="border-border bg-surface sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r px-3 py-5 lg:flex">
      <div className="flex items-center gap-3 px-2">
        <BrandMark className="size-9" />
        <span className="text-fg text-lg font-semibold tracking-tight">Plate</span>
      </div>

      <Link to={`/today/${todayKey()}?log=new`} className={cn(buttonVariants({}), 'mt-6 w-full')}>
        <Plus className="size-4" aria-hidden="true" />
        Log food
      </Link>

      <nav aria-label="Primary" className="mt-6 flex flex-col gap-1">
        {NAV_ITEMS.map((item) => {
          const active = location.pathname.startsWith(item.to);
          return (
            <NavLink
              key={item.to}
              to={item.to}
              className={cn(
                'relative flex h-11 items-center gap-3 rounded-control px-3 text-sm font-medium transition-colors',
                active ? 'text-fg' : 'text-fg-muted hover:text-fg hover:bg-surface-2',
              )}
            >
              {active ? (
                <motion.span
                  layoutId="sidebar-active"
                  className="bg-surface-2 absolute inset-0 -z-10 rounded-control"
                  transition={{ type: 'spring', stiffness: 500, damping: 40 }}
                />
              ) : null}
              <item.icon className={cn('size-5', active && 'text-accent')} aria-hidden="true" />
              {item.label}
            </NavLink>
          );
        })}
      </nav>

      <div className="mt-auto px-1">
        <ThemeCycleButton />
      </div>
    </aside>
  );
}

function TabBar() {
  const location = useLocation();
  return (
    <nav
      aria-label="Primary"
      className="border-border bg-surface/85 fixed inset-x-0 bottom-0 z-40 border-t backdrop-blur-xl lg:hidden"
    >
      <ul className="pb-safe grid grid-cols-5">
        {NAV_ITEMS.map((item) => {
          const active = location.pathname.startsWith(item.to);
          return (
            <li key={item.to}>
              <NavLink
                to={item.to}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex h-[3.75rem] flex-col items-center justify-center gap-1 text-[0.6875rem] font-medium transition-colors',
                  active ? 'text-accent' : 'text-fg-muted active:text-fg',
                )}
              >
                <span className="relative flex h-7 w-12 items-center justify-center">
                  {active ? (
                    <motion.span
                      layoutId="tabbar-active"
                      className="bg-accent-soft absolute inset-0 rounded-full"
                      transition={{ type: 'spring', stiffness: 500, damping: 40 }}
                    />
                  ) : null}
                  <item.icon className="relative size-5" aria-hidden="true" />
                </span>
                {item.label}
              </NavLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

const CYCLE: Record<ThemePreference, ThemePreference> = {
  system: 'light',
  light: 'dark',
  dark: 'system',
};
const LABEL: Record<ThemePreference, string> = {
  system: 'System theme',
  light: 'Light theme',
  dark: 'Dark theme',
};

function ThemeCycleButton() {
  const { preference, setPreference } = useTheme();
  const Icon = preference === 'system' ? SunMoon : preference === 'light' ? Sun : Moon;
  return (
    <Button
      variant="ghost"
      className="text-fg-muted w-full justify-start"
      onClick={() => setPreference(CYCLE[preference])}
      aria-label={`${LABEL[preference]}. Switch theme`}
    >
      <Icon className="size-5" aria-hidden="true" />
      {LABEL[preference]}
    </Button>
  );
}
