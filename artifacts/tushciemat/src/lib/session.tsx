import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetMeQueryKey, setSchoolIdGetter, useGetMe,
  type Me, type SchoolAccess, type SchoolCapability, type SchoolRole,
} from '@workspace/api-client-react';
import { useAuth } from '@/lib/auth';

let activeSchoolId: string | null = null;
setSchoolIdGetter(() => activeSchoolId);

const PENDING_INVITE_KEY = 'tushciemat.pending-invite';

export const pendingInvite = {
  get: () => sessionStorage.getItem(PENDING_INVITE_KEY),
  set: (token: string) => sessionStorage.setItem(PENDING_INVITE_KEY, token),
  clear: () => sessionStorage.removeItem(PENDING_INVITE_KEY),
};

type Session = {
  me: Me;
  school: SchoolAccess | null;
  roles: readonly SchoolRole[];
  capabilities: readonly SchoolCapability[];
  can: (capability: SchoolCapability) => boolean;
  switchSchool: (schoolId: string) => void;
  refreshMe: () => Promise<Me | undefined>;
};

const SessionContext = createContext<Session | null>(null);

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error('useSession must be used inside SessionProvider');
  return session;
}

export function SessionProvider({ children, loading, failed }: {
  children: ReactNode;
  loading: ReactNode;
  failed: (error: unknown, retry: () => void) => ReactNode;
}) {
  const { user } = useAuth();
  const client = useQueryClient();
  const storageKey = `tushciemat.school.${user?.uid}`;
  const me = useGetMe({ query: { retry: 1, staleTime: 60_000 } });
  const [chosen, setChosen] = useState<string | null>(() => localStorage.getItem(storageKey));

  const schools = me.data?.schools ?? [];
  const school = schools.find((s) => s.schoolId === chosen) ?? schools[0] ?? null;
  // Set during render so the first school-scoped request already carries the header.
  activeSchoolId = school?.schoolId ?? null;

  const switchSchool = useCallback((schoolId: string) => {
    activeSchoolId = schoolId;
    localStorage.setItem(storageKey, schoolId);
    setChosen(schoolId);
    const meKey = getGetMeQueryKey()[0];
    client.removeQueries({ predicate: (query) => query.queryKey[0] !== meKey });
  }, [client, storageKey]);

  const refreshMe = useCallback(async () => (await me.refetch()).data, [me]);

  const value = useMemo<Session | null>(() => {
    if (!me.data) return null;
    const roles = school?.roles ?? [];
    const capabilities = school?.capabilities ?? [];
    return {
      me: me.data, school, roles, capabilities,
      can: (capability) => roles.includes('owner') || capabilities.includes(capability),
      switchSchool, refreshMe,
    };
  }, [me.data, school, switchSchool, refreshMe]);

  if (me.isLoading) return <>{loading}</>;
  if (!value) return <>{failed(me.error, () => { void me.refetch(); })}</>;
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
