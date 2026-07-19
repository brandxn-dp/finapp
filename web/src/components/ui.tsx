import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { ReactNode, ButtonHTMLAttributes, InputHTMLAttributes, SelectHTMLAttributes } from "react";

// ---------------- Icons (inline, stroke-based) ----------------

const ICON_PATHS: Record<string, ReactNode> = {
  dashboard: (
    <>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </>
  ),
  list: (
    <>
      <path d="M8 6h13M8 12h13M8 18h13" />
      <path d="M3 6h.01M3 12h.01M3 18h.01" />
    </>
  ),
  target: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1" />
    </>
  ),
  card: (
    <>
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <path d="M2 10h20" />
    </>
  ),
  wallet: (
    <>
      <path d="M21 12V7a2 2 0 0 0-2-2H5a2 2 0 0 1 0-4h12" transform="translate(0 3)" />
      <path d="M3 5v12a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5" />
      <path d="M16 12h.01" />
    </>
  ),
  sliders: (
    <>
      <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3" />
      <path d="M1 14h6M9 8h6M17 16h6" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>
  ),
  moon: <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />,
  plus: <path d="M12 5v14M5 12h14" />,
  upload: (
    <>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="M17 8l-5-5-5 5M12 3v12" />
    </>
  ),
  sparkle: (
    <>
      <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z" />
      <path d="M19 17v4M17 19h4" />
    </>
  ),
  refresh: (
    <>
      <path d="M21 12a9 9 0 1 1-2.6-6.4" />
      <path d="M21 3v5h-5" />
    </>
  ),
  x: <path d="M18 6L6 18M6 6l12 12" />,
  check: <path d="M20 6L9 17l-5-5" />,
  chevronDown: <path d="M6 9l6 6 6-6" />,
  trash: (
    <>
      <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </>
  ),
  link: (
    <>
      <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" />
      <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
    </>
  ),
  alert: (
    <>
      <path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
      <path d="M12 9v4M12 17h.01" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3l7 3v5c0 4.5-3 7.8-7 9-4-1.2-7-4.5-7-9V6l7-3z" />
      <path d="M9 12l2 2 4-4" />
    </>
  )
};

export function Icon({ name, size = 18, className = "" }: { name: string; size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {ICON_PATHS[name] ?? null}
    </svg>
  );
}

// ---------------- Ornament ----------------

/** Art Nouveau flourish — symmetric vine curls around a leaf diamond. */
export function Flourish({ className = "" }: { className?: string }) {
  return (
    <svg
      width="150"
      height="14"
      viewBox="0 0 150 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1"
      strokeLinecap="round"
      className={`flourish-deco ${className}`}
      aria-hidden="true"
    >
      <path d="M4 7 C 22 1.5, 40 12, 58 7 C 62 5.8, 66 5.8, 69 7" />
      <path d="M146 7 C 128 1.5, 110 12, 92 7 C 88 5.8, 84 5.8, 81 7" />
      <path d="M75 3.2 L 78.4 7 L 75 10.8 L 71.6 7 Z" fill="currentColor" stroke="none" />
      <circle cx="4" cy="7" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="146" cy="7" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function PageHeader({
  title,
  sub,
  action
}: {
  title: string;
  sub?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="page-title font-display text-[27px] font-semibold leading-tight tracking-wide text-ink">{title}</h1>
        {sub && <p className="mt-0.5 text-sm text-ink2">{sub}</p>}
        <Flourish className="mt-1.5 text-accent/60" />
      </div>
      {action && <div className="pb-1">{action}</div>}
    </header>
  );
}

// ---------------- Primitives ----------------

export function Card({
  title,
  action,
  children,
  className = "",
  collapsible = false,
  defaultOpen = true,
  summary
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Collapsible sections keep long pages (Settings) tidy. */
  collapsible?: boolean;
  defaultOpen?: boolean;
  /** Short line shown next to the title while collapsed. */
  summary?: ReactNode;
}) {
  const [open, setOpen] = useState(!collapsible || defaultOpen);
  return (
    <section
      className={`card-skeu rounded-[14px] border border-line bg-[var(--glass)] outline outline-1 outline-line/50 outline-offset-[-5px] backdrop-blur-md ${className}`}
    >
      {(title || action) && (
        <header
          className={`flex items-center justify-between gap-3 px-6 pt-4.5 ${open ? "pb-1" : "pb-4"} ${collapsible ? "cursor-pointer select-none" : ""}`}
          onClick={collapsible ? () => setOpen((o) => !o) : undefined}
        >
          <div className="flex min-w-0 items-baseline gap-3">
            {title && (
              <h2 className="font-display smallcaps shrink-0 text-[16px] font-semibold text-ink">{title}</h2>
            )}
            {collapsible && !open && summary && (
              <span className="truncate text-xs text-ink3">{summary}</span>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2" onClick={(e) => collapsible && e.stopPropagation()}>
            {(open || !collapsible) && action}
            {collapsible && (
              <button
                className={`rounded-md p-1 text-ink3 transition-transform hover:text-ink ${open ? "rotate-180" : ""}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setOpen((o) => !o);
                }}
                aria-label={open ? "Collapse" : "Expand"}
              >
                <Icon name="chevronDown" size={16} />
              </button>
            )}
          </div>
        </header>
      )}
      {open && <div className="px-6 py-4">{children}</div>}
    </section>
  );
}

export function Stat({
  label,
  value,
  sub,
  tone = "default",
  onClick
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: "default" | "good" | "bad";
  onClick?: () => void;
}) {
  const toneCls = tone === "good" ? "text-good" : tone === "bad" ? "text-bad" : "text-ink";
  const inner = (
    <>
      <div className="smallcaps text-[12px] font-medium text-ink3">{label}</div>
      <div className={`tnum font-display mt-0.5 text-[26px] font-semibold leading-tight ${toneCls}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-ink2">{sub}</div>}
    </>
  );
  const frame =
    "card-skeu rounded-[14px] border border-line bg-[var(--glass)] px-5 py-4 outline outline-1 outline-line/50 outline-offset-[-4px] backdrop-blur-md";
  if (onClick) {
    return (
      <button onClick={onClick} className={`${frame} block w-full cursor-pointer text-left transition-colors hover:bg-surface2/70`} title="Click for details">
        {inner}
      </button>
    );
  }
  return <div className={frame}>{inner}</div>;
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost" | "danger" | "subtle";
  size?: "sm" | "md";
};

export function Button({ variant = "primary", size = "md", className = "", ...rest }: BtnProps) {
  const base =
    "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed";
  const sizes = size === "sm" ? "h-8 px-3 text-xs" : "h-9 px-4 text-sm";
  const variants = {
    primary: "btn-emboss bg-accent text-accent-fg hover:brightness-108 active:translate-y-px",
    ghost: "btn-ghost border border-line bg-transparent text-ink hover:bg-surface2",
    subtle: "btn-subtle bg-surface2 text-ink hover:brightness-95 dark:hover:brightness-125",
    danger: "btn-danger border border-line text-bad hover:bg-bad/10"
  } as const;
  return <button className={`${base} ${sizes} ${variants[variant]} ${className}`} {...rest} />;
}

export function Input({ className = "", ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`field-skeu h-9 rounded-lg border border-line bg-surface px-3 text-sm text-ink placeholder:text-ink3 focus:outline-none focus:ring-2 focus:ring-accent/40 ${className}`}
      {...rest}
    />
  );
}

export function Select({ className = "", children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={`field-skeu h-9 rounded-lg border border-line bg-surface px-2.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-accent/40 ${className}`}
      {...rest}
    >
      {children}
    </select>
  );
}

export function Modal({
  title,
  onClose,
  children,
  wide = false
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  // Portal to <body> so z-50 clears the fixed bottom nav on mobile (otherwise
  // the modal is trapped in <main>'s stacking context and the nav covers its
  // footer buttons). Extra bottom padding keeps controls above the nav.
  return createPortal(
    <div
      className="modal-overlay fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/45 p-4 pt-[8vh] backdrop-blur-[5px]"
      style={{ paddingBottom: "calc(6rem + env(safe-area-inset-bottom))" }}
      onMouseDown={onClose}
    >
      <div
        className={`card-skeu w-full ${wide ? "max-w-3xl" : "max-w-lg"} rounded-[14px] border border-line bg-[var(--glass)] shadow-2xl outline outline-1 outline-line/60 outline-offset-[-5px] backdrop-blur-2xl`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="font-display smallcaps text-[16px] font-semibold text-ink">{title}</h2>
          <button className="rounded-md p-1 text-ink3 hover:bg-surface2 hover:text-ink" onClick={onClose} aria-label="Close">
            <Icon name="x" size={16} />
          </button>
        </header>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>,
    document.body
  );
}

export function Empty({ icon, title, sub }: { icon: string; title: string; sub?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
      <div className="flex h-11 w-11 items-center justify-center rounded-full bg-surface2 text-ink3">
        <Icon name={icon} size={20} />
      </div>
      <div className="text-sm font-medium text-ink">{title}</div>
      {sub && <div className="max-w-sm text-xs text-ink2">{sub}</div>}
    </div>
  );
}

export function Spinner({ className = "" }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} width="16" height="16" viewBox="0 0 24 24" fill="none" aria-label="Loading">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-20" />
      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

// ---------------- Toasts ----------------

interface ToastMsg {
  id: number;
  text: string;
  tone: "info" | "good" | "bad";
}

const ToastContext = createContext<{ toast: (text: string, tone?: ToastMsg["tone"]) => void }>({
  toast: () => {}
});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastMsg[]>([]);
  const toast = useCallback((text: string, tone: ToastMsg["tone"] = "info") => {
    const id = Date.now() + Math.random();
    setItems((prev) => [...prev, { id, text, tone }]);
    setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), 6000);
  }, []);
  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="pointer-events-none fixed bottom-20 left-1/2 z-[60] flex w-full max-w-md -translate-x-1/2 flex-col gap-2 px-4 md:bottom-6">
        {items.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto rounded-lg border border-line bg-surface px-4 py-2.5 text-sm shadow-lg backdrop-blur-md ${
              t.tone === "good" ? "text-good" : t.tone === "bad" ? "text-bad" : "text-ink"
            }`}
          >
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

// ---------------- Tiny markdown renderer (for AI check-ins) ----------------

function inline(text: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) =>
    p.startsWith("**") && p.endsWith("**") ? (
      <strong key={i} className="font-semibold text-ink">
        {p.slice(2, -2)}
      </strong>
    ) : (
      p
    )
  );
}

export function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  const lines = text.split("\n");
  let list: string[] = [];
  const flushList = (key: number) => {
    if (list.length) {
      blocks.push(
        <ul key={`ul-${key}`} className="my-2 list-disc space-y-1 pl-5 text-sm text-ink2">
          {list.map((li, i) => (
            <li key={i}>{inline(li)}</li>
          ))}
        </ul>
      );
      list = [];
    }
  };
  lines.forEach((line, i) => {
    const t = line.trim();
    if (t.startsWith("- ") || t.startsWith("* ")) {
      list.push(t.slice(2));
      return;
    }
    flushList(i);
    if (t.startsWith("### ")) blocks.push(<h4 key={i} className="mt-3 text-sm font-semibold text-ink">{inline(t.slice(4))}</h4>);
    else if (t.startsWith("## ")) blocks.push(<h3 key={i} className="mt-4 text-sm font-semibold text-ink">{inline(t.slice(3))}</h3>);
    else if (t.startsWith("# ")) blocks.push(<h3 key={i} className="mt-4 text-base font-semibold text-ink">{inline(t.slice(2))}</h3>);
    else if (t) blocks.push(<p key={i} className="my-2 text-sm leading-relaxed text-ink2">{inline(t)}</p>);
  });
  flushList(lines.length);
  return <div>{blocks}</div>;
}
