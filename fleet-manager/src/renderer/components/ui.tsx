/**
 * Small, dependency-free UI primitives shared across every page.
 *
 * Keeping them here (rather than pulling in a component library) keeps the bundle small and the
 * styling consistent with the Logvex design tokens in styles.css.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { copyText, type FriendlyError } from '../lib/errors';

export function Card({ title, sub, actions, children, className = '' }: {
  title?: string; sub?: string; actions?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <div className={`card ${className}`}>
      {(title || actions) && (
        <div className="row between" style={{ marginBottom: title ? 12 : 0 }}>
          <div>
            {title && <div className="card-title" style={{ marginBottom: sub ? 2 : 0 }}>{title}</div>}
            {sub && <div className="card-sub">{sub}</div>}
          </div>
          {actions && <div className="row">{actions}</div>}
        </div>
      )}
      {children}
    </div>
  );
}

export function Button({ children, onClick, variant = 'default', disabled, small, title }: {
  children: ReactNode; onClick?: () => void; variant?: 'default' | 'primary' | 'danger' | 'ghost'; disabled?: boolean; small?: boolean; title?: string;
}) {
  return (
    <button
      className={`btn ${variant === 'default' ? '' : variant} ${small ? 'sm' : ''}`}
      onClick={onClick}
      disabled={disabled}
      title={title}
    >
      {children}
    </button>
  );
}

export function Pill({ children, tone = 'muted' }: { children: ReactNode; tone?: string }) {
  return <span className={`pill ${tone}`}>{children}</span>;
}

export function Dot({ state }: { state: string }) {
  const cls = state === 'ONLINE' || state === 'RUNNING' ? 'online'
    : state === 'CONNECTING' || state === 'AUTHENTICATING' || state === 'INITIALIZING' || state === 'VALIDATING' || state === 'WAITING' ? 'connecting'
      : state === 'ERROR' || state === 'FAILED' ? 'error' : 'offline';
  return <span className={`dot ${cls}`} />;
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}

export function Modal({ title, onClose, children, footer, wide }: {
  title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean;
}) {
  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className={`modal ${wide ? 'wide' : ''}`} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span>{title}</span>
          <div className="spacer" />
          <Button variant="ghost" small onClick={onClose}>✕</Button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function Stat({ value, label }: { value: ReactNode; label: string }) {
  return (
    <div className="stat">
      <div className="value">{value}</div>
      <div className="label">{label}</div>
    </div>
  );
}

export function Expandable({ title, children, defaultOpen = false }: {
  title: ReactNode; children: ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="expandable">
      <div className="expandable-header" onClick={() => setOpen((v) => !v)}>
        <span>{open ? '▾' : '▸'}</span>
        {title}
      </div>
      {open && <div className="expandable-body">{children}</div>}
    </div>
  );
}

export interface ToastItem { id: number; message: string; tone?: string }

export function useToasts() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const push = (message: string, tone?: string): void => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, message, tone }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000);
  };
  return { toasts, push };
}

export function ToastStack({ toasts }: { toasts: ToastItem[] }) {
  return (
    <div className="toast-stack">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.tone ?? ''}`}>{t.message}</div>
      ))}
    </div>
  );
}

export function ProgressBar({ value, color }: { value: number; color?: string }) {
  return (
    <div className="bar">
      <div style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: color ?? 'var(--accent)' }} />
    </div>
  );
}

/** Circular progress ring used for setup completion and health. */
export function Ring({ value, size = 76, label, color }: { value: number; size?: number; label?: ReactNode; color?: string }) {
  const pct = Math.max(0, Math.min(1, value));
  const stroke = 7;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  return (
    <div className="ring" style={{ position: 'relative', width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--bg-hover)" strokeWidth={stroke} />
        <circle
          cx={size / 2} cy={size / 2} r={radius} fill="none"
          stroke={color ?? 'var(--accent)'} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={circumference} strokeDashoffset={circumference * (1 - pct)}
        />
      </svg>
      <div style={{
        position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', fontSize: 15, fontWeight: 700,
      }}>
        {label ?? `${Math.round(pct * 100)}%`}
      </div>
    </div>
  );
}

/** Coloured message block used for guidance, warnings and errors. */
export function Callout({ tone = 'info', icon, title, children, actions }: {
  tone?: 'info' | 'success' | 'warning' | 'error';
  icon?: string; title?: ReactNode; children?: ReactNode; actions?: ReactNode;
}) {
  const fallback = tone === 'error' ? '⛔' : tone === 'warning' ? '⚠️' : tone === 'success' ? '✅' : 'ℹ️';
  return (
    <div className={`callout ${tone}`}>
      <span className="callout-icon">{icon ?? fallback}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        {title && <div className="callout-title">{title}</div>}
        {children && <div className="callout-body">{children}</div>}
        {actions && <div className="callout-actions">{actions}</div>}
      </div>
    </div>
  );
}

/** Small "?" badge that reveals an explanation on hover/focus. */
export function Tip({ text }: { text: string }) {
  return (
    <span className="field-tip">
      <span className="q" tabIndex={0} aria-label={text}>?</span>
      <span className="tip">{text}</span>
    </span>
  );
}

/** Two-state toggle used for Beginner/Advanced mode. */
export function Segmented<T extends string>({ value, options, onChange }: {
  value: T; options: { value: T; label: string }[]; onChange: (value: T) => void;
}) {
  return (
    <div className="segmented">
      {options.map((option) => (
        <button
          key={option.value}
          className={value === option.value ? 'active' : ''}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** Confirmation dialog for destructive or important actions. */
export function ConfirmDialog({ title, message, confirmLabel = 'Confirm', danger, onConfirm, onCancel }: {
  title: string; message: ReactNode; confirmLabel?: string; danger?: boolean;
  onConfirm: () => void; onCancel: () => void;
}) {
  return (
    <Modal
      title={title}
      onClose={onCancel}
      footer={<>
        <Button onClick={onCancel}>Cancel</Button>
        <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm}>{confirmLabel}</Button>
      </>}
    >
      <div className="card-sub" style={{ fontSize: 13, lineHeight: 1.6 }}>{message}</div>
    </Modal>
  );
}

/** Friendly empty state with an optional primary action. */
export function EmptyState({ icon, title, children, action }: {
  icon?: string; title: string; children?: ReactNode; action?: ReactNode;
}) {
  return (
    <div className="empty">
      {icon && <div style={{ fontSize: 28, marginBottom: 8 }}>{icon}</div>}
      <div style={{ fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>{title}</div>
      {children && <div style={{ maxWidth: 420, margin: '0 auto' }}>{children}</div>}
      {action && <div style={{ marginTop: 14 }}>{action}</div>}
    </div>
  );
}

/** Plain-language error with a copy button for the technical details. */
export function ErrorNotice({ error, onDismiss }: { error: FriendlyError; onDismiss?: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <Callout
      tone="error"
      title={error.title}
      actions={<>
        <Button
          small
          onClick={async () => {
            const ok = await copyText(error.technical);
            setCopied(ok);
            setTimeout(() => setCopied(false), 2000);
          }}
        >
          {copied ? 'Copied ✓' : 'Copy technical details'}
        </Button>
        {onDismiss && <Button small variant="ghost" onClick={onDismiss}>Dismiss</Button>}
      </>}
    >
      {error.hint}
    </Callout>
  );
}
