import { cn } from '@/lib/cn';

/** The app icon as inline SVG so it inherits sizing and never flashes while loading. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 512 512" className={cn('size-10 shrink-0', className)} aria-hidden="true">
      <defs>
        <linearGradient id="plate-brand-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#FB923C" />
          <stop offset="1" stopColor="#EA580C" />
        </linearGradient>
      </defs>
      <rect width="512" height="512" rx="112" fill="url(#plate-brand-g)" />
      <circle cx="256" cy="256" r="150" fill="#fff" />
      <circle cx="256" cy="256" r="110" fill="none" stroke="#FDBA74" strokeWidth="12" />
      <circle cx="256" cy="256" r="46" fill="#F97316" />
    </svg>
  );
}
