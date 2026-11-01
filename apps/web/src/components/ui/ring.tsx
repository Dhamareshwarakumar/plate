import type { DayStatus } from '@plate/shared';
import { motion, useReducedMotion, useSpring, useTransform } from 'motion/react';
import { useEffect, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface RingProps {
  /** Amount eaten. */
  value: number;
  /** The goal; a non-positive max renders an empty ring. */
  max: number;
  /** Drives the stroke colour: accent while under, green inside the band, red over (DESIGN §2.1). */
  status: DayStatus;
  /** Outer diameter in px. */
  size?: number;
  strokeWidth?: number;
  /** Text alternative, e.g. "1,420 of 2,000 kcal". */
  label: string;
  /** Rendered centred inside the ring. */
  children?: ReactNode;
  className?: string;
}

const STROKE_BY_STATUS: Record<DayStatus, string> = {
  not_logged: 'stroke-accent',
  no_goal: 'stroke-accent',
  under: 'stroke-accent',
  on_target: 'stroke-on-target',
  over: 'stroke-over',
};

/**
 * Animated progress ring (SVG). The stroke springs to the new fill whenever the value changes and
 * caps at a full circle; colour alone never carries the status, so callers add a label too.
 */
export function Ring({
  value,
  max,
  status,
  size = 176,
  strokeWidth = 12,
  label,
  children,
  className,
}: RingProps) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = max > 0 ? Math.min(Math.max(value / max, 0), 1) : 0;
  const reduceMotion = useReducedMotion();
  const spring = useSpring(progress, { stiffness: 90, damping: 22 });
  useEffect(() => {
    if (reduceMotion) spring.jump(progress);
    else spring.set(progress);
  }, [spring, progress, reduceMotion]);
  const dashOffset = useTransform(spring, (p) => circumference * (1 - p));

  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={Math.max(0, Math.round(max))}
      aria-valuenow={Math.round(Math.min(Math.max(value, 0), Math.max(max, 0)))}
      aria-valuetext={label}
      className={cn('relative shrink-0', className)}
      style={{ width: size, height: size }}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="-rotate-90"
        aria-hidden="true"
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          className="stroke-surface-3"
        />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          style={{ strokeDashoffset: dashOffset }}
          className={cn('transition-[stroke] duration-300', STROKE_BY_STATUS[status])}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        {children}
      </div>
    </div>
  );
}
