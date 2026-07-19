import { useEffect } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import Layout from "./components/Layout";
import Dashboard from "./pages/Dashboard";
import Transactions from "./pages/Transactions";
import Budget from "./pages/Budget";
import Debts from "./pages/Debts";
import Savings from "./pages/Savings";
import Settings from "./pages/Settings";
import Login from "./pages/Login";
import Invite from "./pages/Invite";
import { useAuth } from "./lib/auth";
import { Spinner } from "./components/ui";

const PENDING_INVITE = "finapp-pending-invite";

export default function App() {
  const { me, loading } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  // Remember an invite link opened while signed out, so we can complete it after login.
  useEffect(() => {
    const m = location.pathname.match(/^\/invite\/(.+)$/);
    if (m) localStorage.setItem(PENDING_INVITE, m[1]);
  }, [location.pathname]);

  // Once signed in, if there's a pending invite, jump to it.
  useEffect(() => {
    if (me?.user) {
      const token = localStorage.getItem(PENDING_INVITE);
      if (token && !location.pathname.startsWith("/invite/")) {
        navigate(`/invite/${token}`, { replace: true });
      }
    }
  }, [me?.user, location.pathname, navigate]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-ink3">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }

  if (!me?.user) {
    return <Login />;
  }

  return (
    <Routes>
      <Route path="/invite/:token" element={<Invite />} />
      <Route element={<Layout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/transactions" element={<Transactions />} />
        <Route path="/budget" element={<Budget />} />
        <Route path="/debts" element={<Debts />} />
        <Route path="/savings" element={<Savings />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
