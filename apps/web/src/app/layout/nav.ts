import {
  Apple,
  ChartColumn,
  Ellipsis,
  Scale,
  UtensilsCrossed,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
}

/** The five destinations shared by the phone tab bar and the desktop sidebar. */
export const NAV_ITEMS: readonly NavItem[] = [
  { to: '/today', label: 'Today', icon: UtensilsCrossed },
  { to: '/foods', label: 'Foods', icon: Apple },
  { to: '/insights', label: 'Insights', icon: ChartColumn },
  { to: '/weight', label: 'Weight', icon: Scale },
  { to: '/more', label: 'More', icon: Ellipsis },
];
