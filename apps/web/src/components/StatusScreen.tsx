import type { ReactNode } from 'react';

/**
 * Full-width message for the states without a match on screen (no match, invalid link, network down). `logo`: shown
 * centred in place of the title, which stays for screen readers.
 */
export function StatusScreen({
  title,
  children,
  tone = 'neutral',
  action,
  logo,
}: {
  title: string;
  children?: ReactNode;
  tone?: 'neutral' | 'warn' | 'error';
  action?: ReactNode;
  logo?: ReactNode;
}) {
  const border = tone === 'error' ? 'border-danger' : tone === 'warn' ? 'border-warn' : 'border-border';
  return (
    <div className="flex min-h-[50dvh] items-center justify-center p-4">
      <div
        role={tone === 'error' ? 'alert' : 'status'}
        className={`w-full max-w-md rounded-panel border bg-surface p-6 text-center shadow-card ${border}`}
      >
        {logo && <div className="flex justify-center">{logo}</div>}
        <h1 className={logo ? 'sr-only' : 'font-display text-2xl font-bold uppercase tracking-wide text-text'}>
          {title}
        </h1>
        {children && <div className="mt-2 text-sm text-muted">{children}</div>}
        {action && <div className="mt-4 flex justify-center">{action}</div>}
      </div>
    </div>
  );
}
