import React from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import type { BookingStatus } from '../../shared/types';
import { BOOKING_STATUS_LABELS } from '../../shared/types';

export function SectionHeading({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="flex flex-col items-center text-center mb-12">
      <h2 className="text-4xl sm:text-5xl font-black tracking-tighter uppercase mb-4">{title}</h2>
      <div className="w-24 h-1 bg-gradient-to-r from-orange-500 to-red-500 rounded-full" />
      {subtitle && <p className="mt-5 text-text-muted max-w-xl">{subtitle}</p>}
    </div>
  );
}

export function Spinner({ className = 'w-5 h-5' }: { className?: string }) {
  return <Loader2 className={`${className} animate-spin`} aria-hidden />;
}

export function ErrorNote({ children }: { children: React.ReactNode }) {
  if (!children) return null;
  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400"
    >
      <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" aria-hidden />
      <span>{children}</span>
    </div>
  );
}

const STATUS_STYLES: Record<BookingStatus, string> = {
  pending: 'bg-amber-500/15 text-amber-500 border-amber-500/30',
  confirmed: 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30',
  completed: 'bg-sky-500/15 text-sky-500 border-sky-500/30',
  cancelled: 'bg-text-muted/10 text-text-muted border-border',
  no_show: 'bg-red-500/15 text-red-400 border-red-500/30',
};

export function StatusBadge({ status }: { status: BookingStatus }) {
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full border px-3 py-1 text-xs font-semibold ${STATUS_STYLES[status]}`}
    >
      {BOOKING_STATUS_LABELS[status]}
    </span>
  );
}

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'ghost' | 'danger';
  loading?: boolean;
};

const VARIANTS = {
  primary:
    'bg-orange-500 hover:bg-orange-600 text-white shadow-[0_0_20px_-5px_rgba(249,115,22,0.4)] hover:shadow-[0_0_30px_-5px_rgba(249,115,22,0.6)]',
  ghost: 'bg-surface hover:bg-surface-hover border border-border text-text-main',
  danger: 'bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-400',
};

export function Button({ variant = 'primary', loading, children, className = '', ...props }: ButtonProps) {
  return (
    <button
      {...props}
      disabled={props.disabled || loading}
      className={`inline-flex items-center justify-center gap-2 rounded-xl px-5 py-3 font-bold transition-all
        focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-orange-500/30
        disabled:opacity-50 disabled:cursor-not-allowed ${VARIANTS[variant]} ${className}`}
    >
      {loading && <Spinner className="w-4 h-4" />}
      {children}
    </button>
  );
}

export function Field({
  label,
  icon,
  hint,
  children,
}: {
  label: string;
  icon?: React.ReactNode;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="space-y-2 block">
      <span className="text-sm font-medium text-text-muted flex items-center gap-2">
        {icon}
        {label}
      </span>
      {children}
      {hint && <span className="block text-xs text-text-muted">{hint}</span>}
    </label>
  );
}

export const inputClass =
  'w-full bg-surface border border-border rounded-xl px-4 py-3 text-text-main placeholder:text-text-muted/50 ' +
  'focus:outline-none focus:border-orange-500 focus:bg-surface-hover focus:ring-4 focus:ring-orange-500/10 transition-all';
