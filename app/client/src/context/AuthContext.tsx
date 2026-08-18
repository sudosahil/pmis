import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, setSessionExpiredHandler, tokenStore } from '../api/client';
import type { LoginResponse, RoleCode, User } from '../types';

interface AuthState {
  user: User | null;
  status: 'loading' | 'authenticated' | 'anonymous';
  mustChangePassword: boolean;
}

interface AuthContextValue extends AuthState {
  signIn: (username: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshUser: () => Promise<void>;
  clearPasswordPrompt: () => void;
  /** True when the signed-in user holds any of the given roles. */
  hasRole: (...roles: RoleCode[]) => boolean;
  isContractor: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    status: 'loading',
    mustChangePassword: false,
  });

  // Restore the session on first load if a token is already stored.
  useEffect(() => {
    let cancelled = false;

    async function restore() {
      if (!tokenStore.access) {
        if (!cancelled) setState({ user: null, status: 'anonymous', mustChangePassword: false });
        return;
      }
      try {
        const user = await api.get<User>('/auth/me');
        if (!cancelled) setState({ user, status: 'authenticated', mustChangePassword: false });
      } catch {
        tokenStore.clear();
        if (!cancelled) setState({ user: null, status: 'anonymous', mustChangePassword: false });
      }
    }

    void restore();
    return () => {
      cancelled = true;
    };
  }, []);

  // A failed refresh anywhere in the app drops the session here.
  useEffect(() => {
    setSessionExpiredHandler(() => {
      setState({ user: null, status: 'anonymous', mustChangePassword: false });
    });
  }, []);

  const signIn = useCallback(async (username: string, password: string) => {
    const result = await api.anonymousPost<LoginResponse>('/auth/login', { username, password });
    tokenStore.set(result.accessToken, result.refreshToken);
    setState({
      user: result.user,
      status: 'authenticated',
      mustChangePassword: result.mustChangePassword,
    });
  }, []);

  const signOut = useCallback(async () => {
    try {
      await api.post('/auth/logout', { refreshToken: tokenStore.refresh });
    } catch {
      // Signing out locally must succeed even if the server call does not.
    }
    tokenStore.clear();
    setState({ user: null, status: 'anonymous', mustChangePassword: false });
  }, []);

  const refreshUser = useCallback(async () => {
    const user = await api.get<User>('/auth/me');
    setState((prev) => ({ ...prev, user }));
  }, []);

  const clearPasswordPrompt = useCallback(() => {
    setState((prev) => ({ ...prev, mustChangePassword: false }));
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      ...state,
      signIn,
      signOut,
      refreshUser,
      clearPasswordPrompt,
      hasRole: (...roles: RoleCode[]) => Boolean(state.user && roles.includes(state.user.roleCode)),
      isContractor: state.user?.roleCode === 'CONTRACTOR',
    }),
    [state, signIn, signOut, refreshUser, clearPasswordPrompt],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside an AuthProvider.');
  return context;
}
