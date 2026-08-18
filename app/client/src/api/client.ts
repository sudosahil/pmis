/**
 * Thin fetch wrapper around the PMIS API.
 *
 * Access tokens are short lived, so a 401 triggers one silent refresh and a
 * single replay of the original request. Concurrent 401s share the same
 * refresh promise rather than each starting their own.
 */

export interface ApiErrorBody {
  message: string;
  code: string;
  details?: Record<string, string>;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  /** Field-level messages, keyed by form field name. */
  readonly fieldErrors: Record<string, string>;

  constructor(status: number, body: ApiErrorBody) {
    super(body.message);
    this.name = 'ApiError';
    this.status = status;
    this.code = body.code;
    this.fieldErrors = body.details ?? {};
  }
}

const ACCESS_KEY = 'pmis.accessToken';
const REFRESH_KEY = 'pmis.refreshToken';

export const tokenStore = {
  get access(): string | null {
    return localStorage.getItem(ACCESS_KEY);
  },
  get refresh(): string | null {
    return localStorage.getItem(REFRESH_KEY);
  },
  set(access: string, refresh: string): void {
    localStorage.setItem(ACCESS_KEY, access);
    localStorage.setItem(REFRESH_KEY, refresh);
  },
  clear(): void {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
  },
};

type SessionExpiredHandler = () => void;
let onSessionExpired: SessionExpiredHandler = () => {};

export function setSessionExpiredHandler(handler: SessionExpiredHandler): void {
  onSessionExpired = handler;
}

let refreshPromise: Promise<boolean> | null = null;

async function refreshAccessToken(): Promise<boolean> {
  const refreshToken = tokenStore.refresh;
  if (!refreshToken) return false;

  const response = await fetch('/api/auth/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });

  if (!response.ok) {
    tokenStore.clear();
    return false;
  }

  const body = (await response.json()) as { data: { accessToken: string; refreshToken: string } };
  tokenStore.set(body.data.accessToken, body.data.refreshToken);
  return true;
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  /** Skips the bearer header — used by login and public registration. */
  anonymous?: boolean;
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const url = `/api${path.startsWith('/') ? path : `/${path}`}`;
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

async function send<T>(path: string, options: RequestOptions, isRetry = false): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (!options.anonymous) {
    const token = tokenStore.access;
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(buildUrl(path, options.query), {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  if (response.status === 204) return undefined as T;

  if (response.status === 401 && !options.anonymous && !isRetry) {
    refreshPromise ??= refreshAccessToken().finally(() => {
      refreshPromise = null;
    });
    const refreshed = await refreshPromise;
    if (refreshed) return send<T>(path, options, true);

    tokenStore.clear();
    onSessionExpired();
    throw new ApiError(401, {
      message: 'Your session has expired. Please sign in again.',
      code: 'UNAUTHORIZED',
    });
  }

  let payload: { data: T; error: ApiErrorBody | null };
  try {
    payload = await response.json();
  } catch {
    throw new ApiError(response.status, {
      message: 'The server returned an unexpected response.',
      code: 'BAD_RESPONSE',
    });
  }

  if (!response.ok || payload.error) {
    throw new ApiError(
      response.status,
      payload.error ?? { message: 'Something went wrong.', code: 'UNKNOWN' },
    );
  }

  return payload.data;
}

export const api = {
  get: <T>(path: string, query?: RequestOptions['query']) => send<T>(path, { query }),
  post: <T>(path: string, body?: unknown, query?: RequestOptions['query']) =>
    send<T>(path, { method: 'POST', body, query }),
  patch: <T>(path: string, body?: unknown) => send<T>(path, { method: 'PATCH', body }),
  put: <T>(path: string, body?: unknown) => send<T>(path, { method: 'PUT', body }),
  delete: <T>(path: string) => send<T>(path, { method: 'DELETE' }),
  /** For login and contractor self-registration, which carry no token. */
  anonymousPost: <T>(path: string, body: unknown) =>
    send<T>(path, { method: 'POST', body, anonymous: true }),
};

/** Shape returned by every paginated list endpoint. */
export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
