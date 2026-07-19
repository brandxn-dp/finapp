import { useState } from "react";
import { useAuth } from "../lib/auth";
import { Button, Icon, Input, Spinner } from "../components/ui";

export default function Login() {
  const { me, login, register } = useAuth();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const registrationOpen = me?.registration_open !== false;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === "login") await login(email.trim(), password);
      else await register(email.trim(), name.trim(), password);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-full items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="font-display text-[32px] font-bold leading-none tracking-wide text-ink">
            Fin<span className="text-accent">App</span>
          </div>
          <div className="smallcaps mt-1 text-[11px] tracking-[0.28em] text-ink3">self·hosted ledger</div>
        </div>

        <div className="card-skeu rounded-[14px] border border-line bg-[var(--glass)] p-6 outline outline-1 outline-line/50 outline-offset-[-5px] backdrop-blur-md">
          <h1 className="font-display smallcaps mb-4 text-center text-[18px] font-semibold text-ink">
            {mode === "login" ? "Sign in" : "Create your account"}
          </h1>

          <form onSubmit={submit} className="space-y-3">
            {mode === "register" && (
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-ink2">Name</span>
                <Input value={name} onChange={(e) => setName(e.target.value)} className="w-full" placeholder="Your name" autoComplete="name" />
              </label>
            )}
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-ink2">Email</span>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full"
                placeholder="you@example.com"
                autoComplete="email"
                required
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-ink2">Password</span>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full"
                placeholder={mode === "register" ? "At least 8 characters" : "Your password"}
                autoComplete={mode === "register" ? "new-password" : "current-password"}
                required
              />
            </label>

            {error && <p className="text-sm text-bad">{error}</p>}

            <Button type="submit" disabled={busy} className="w-full">
              {busy ? <Spinner /> : <Icon name={mode === "login" ? "check" : "plus"} size={14} />}
              {mode === "login" ? "Sign in" : "Create account"}
            </Button>
          </form>

          {registrationOpen && (
            <p className="mt-4 text-center text-xs text-ink3">
              {mode === "login" ? "Don't have an account? " : "Already have an account? "}
              <button
                className="font-medium text-accent hover:underline"
                onClick={() => {
                  setMode(mode === "login" ? "register" : "login");
                  setError(null);
                }}
              >
                {mode === "login" ? "Create one" : "Sign in"}
              </button>
            </p>
          )}
        </div>

        <p className="mt-4 text-center text-[11px] leading-relaxed text-ink3">
          Your data is private to your account. Serve this over HTTPS (a reverse proxy) before exposing it to the
          internet.
        </p>
      </div>
    </div>
  );
}
