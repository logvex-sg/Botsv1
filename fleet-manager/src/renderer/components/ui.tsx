/**
 * Small, dependency-free UI primitives shared across every page.
 *
 * Keeping them here (rather than pulling in a component library) keeps the bundle small and the
 * styling consistent with the Logvex design tokens in styles.css.
 */
import { useEffect, useState, type ReactNode } from 'react';

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

export function RolePill({ role }: { role: string }) {
  return <span className={`pill ${role.toLowerCase()}`}>{role}</span>;
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
