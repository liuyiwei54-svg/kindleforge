import { cn } from '@/components/ui/cn';

export function ProgressBar({
  value,
  label,
  indeterminate,
  className,
}: {
  value: number;
  label: string;
  indeterminate?: boolean;
  className?: string;
}) {
  const clamped = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate ? undefined : clamped}
      aria-valuetext={indeterminate ? label : `${clamped}%`}
      className={cn('h-1.5 w-full overflow-hidden rounded-full bg-paper/10', className)}
    >
      <div
        className={cn(
          'h-full rounded-full bg-moss-500 transition-[width] duration-300 ease-out',
          indeterminate && 'w-1/2 animate-pulse',
        )}
        style={indeterminate ? undefined : { width: `${clamped}%` }}
      />
    </div>
  );
}
