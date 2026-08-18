import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { LookupOption } from '../types';

/**
 * Loads the options for a master dropdown.
 *
 * Passing `parentId` narrows the list to that parent, which is how the
 * Zone → Circle → Division → Sub Division and District → Town chains cascade.
 * The query stays disabled until a parent is chosen, so a child dropdown never
 * shows options from the wrong branch.
 */
export function useLookup(masterKey: string, parentId?: string | number | null) {
  const parent = parentId ? Number(parentId) : undefined;
  const needsParent = parentId !== undefined;

  return useQuery({
    queryKey: ['masters', masterKey, 'options', parent ?? null],
    queryFn: () =>
      api.get<LookupOption[]>(`/masters/${masterKey}/options`, { parentId: parent }),
    enabled: !needsParent || Boolean(parent),
    // Master data changes rarely; keeping it cached avoids refetching on every form open.
    staleTime: 5 * 60 * 1000,
  });
}
