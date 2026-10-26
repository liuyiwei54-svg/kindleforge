import Link from 'next/link';
import type { AnchorHTMLAttributes, ButtonHTMLAttributes } from 'react';
import { cn } from './cn';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

const base =
  'inline-flex items-center justify-center gap-2 rounded-full font-medium transition-colors duration-200 ease-out disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-moss-500 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-950';

const variants: Record<Variant, string> = {
  primary: 'bg-moss-500 text-ink-950 hover:bg-moss-400 active:bg-moss-600',
  secondary: 'border border-paper/20 bg-ink-900/80 text-paper hover:border-paper/40 hover:bg-ink-800',
  ghost: 'text-paper-dim hover:bg-paper/5 hover:text-paper',
  danger: 'border border-clay/50 bg-clay/10 text-clay hover:bg-clay/20',
};

const sizes: Record<Size, string> = {
  sm: 'px-3 py-1.5 text-sm',
  md: 'px-5 py-2.5 text-sm',
  lg: 'px-6 py-3 text-base',
};

export function buttonClass(variant: Variant = 'primary', size: Size = 'md', className?: string) {
  return cn(base, variants[variant], sizes[size], className);
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export function Button({ variant = 'primary', size = 'md', className, type = 'button', ...props }: ButtonProps) {
  return <button type={type} className={buttonClass(variant, size, className)} {...props} />;
}

export interface ButtonLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  href: string;
  variant?: Variant;
  size?: Size;
  external?: boolean;
}

export function ButtonLink({
  href,
  variant = 'primary',
  size = 'md',
  className,
  external,
  children,
  ...props
}: ButtonLinkProps) {
  const classes = buttonClass(variant, size, className);
  if (external) {
    return (
      <a href={href} className={classes} rel="noreferrer noopener" {...props}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={classes} {...props}>
      {children}
    </Link>
  );
}
