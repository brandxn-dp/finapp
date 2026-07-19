import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { api } from "./api";

export interface AuthUser {
  id: number;
  email: string;
  name: string;
}

export interface Household {
  id: number;
  name: string;
  role: string;
  members: number;
}

export interface Me {
  user: AuthUser | null;
  households: Household[];
  active_household_id: number | null;
  is_first_user: boolean;
  unclaimed_count: number;
  registration_open: boolean;
}

interface AuthCtx {
  me: Me | null;
  loading: boolean;
  refresh: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, name: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  switchHousehold: (id: number) => Promise<void>;
}

const Ctx = createContext<AuthCtx>(null as unknown as AuthCtx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await api.get<Me>("/api/auth/me");
      setMe(data);
    } catch {
      setMe({ user: null, households: [], active_household_id: null, is_first_user: false, unclaimed_count: 0, registration_open: true });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const login = useCallback(async (email: string, password: string) => {
    setMe(await api.post<Me>("/api/auth/login", { email, password }));
  }, []);

  const register = useCallback(async (email: string, name: string, password: string) => {
    setMe(await api.post<Me>("/api/auth/register", { email, name, password }));
  }, []);

  const logout = useCallback(async () => {
    await api.post("/api/auth/logout");
    setMe({ user: null, households: [], active_household_id: null, is_first_user: false, unclaimed_count: 0, registration_open: true });
  }, []);

  const switchHousehold = useCallback(async (id: number) => {
    setMe(await api.post<Me>("/api/households/switch", { household_id: id }));
    // Data is per-household — a hard reload is the simplest correct refresh.
    window.location.reload();
  }, []);

  return (
    <Ctx.Provider value={{ me, loading, refresh, login, register, logout, switchHousehold }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  return useContext(Ctx);
}
