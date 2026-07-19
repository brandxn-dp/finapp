import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Button, Icon, Spinner } from "../components/ui";

interface InviteInfo {
  household_name: string;
  valid: boolean;
  already_member: boolean;
}

export default function Invite() {
  const { token } = useParams();
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .get<InviteInfo>(`/api/invites/${token}`)
      .then(setInfo)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [token]);

  const done = () => {
    localStorage.removeItem("finapp-pending-invite");
    navigate("/", { replace: true });
  };

  const join = async () => {
    setBusy(true);
    try {
      await api.post("/api/households/join", { token });
      await refresh();
      done();
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-full items-center justify-center px-4 py-10">
      <div className="card-skeu w-full max-w-sm rounded-[14px] border border-line bg-[var(--glass)] p-6 text-center outline outline-1 outline-line/50 outline-offset-[-5px] backdrop-blur-md">
        <h1 className="font-display smallcaps mb-3 text-[18px] font-semibold text-ink">Household invite</h1>
        {error ? (
          <p className="text-sm text-bad">{error}</p>
        ) : !info ? (
          <div className="flex justify-center py-4 text-ink3"><Spinner /></div>
        ) : info.already_member ? (
          <p className="text-sm text-ink2">You're already a member of <strong>{info.household_name}</strong>.</p>
        ) : !info.valid ? (
          <p className="text-sm text-ink2">This invite has expired or already been used.</p>
        ) : (
          <>
            <p className="mb-4 text-sm text-ink2">
              You've been invited to join <strong className="text-ink">{info.household_name}</strong> and share its
              finances.
            </p>
            <Button onClick={join} disabled={busy} className="w-full">
              {busy ? <Spinner /> : <Icon name="check" size={14} />} Join household
            </Button>
          </>
        )}
        <button className="mt-4 text-xs text-ink3 hover:text-ink" onClick={done}>
          ← Back to my finances
        </button>
      </div>
    </div>
  );
}
