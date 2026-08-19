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

/**
 * Where the API lives. Empty means same origin, which is what the dev proxy and
 * a single-host deployment both give. Set VITE_API_BASE_URL at build time when
 * the API is hosted separately from the site — as it is on Vercel, where the
 * static site and the Express server cannot share an origin.
 */
const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');

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

  const response = await fetch(buildUrl('/auth/refresh'), {
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
  const url = `${API_BASE}/api${path.startsWith('/') ? path : `/${path}`}`;
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

/**
 * Multipart upload. Kept apart from `send` because the body must stay a
 * FormData — setting Content-Type by hand would strip the boundary — and the
 * caller wants progress, which fetch does not report.
 */
async function uploadFile<T>(
  path: string,
  file: File,
  fields: Record<string, string | number | undefined>,
  onProgress?: (percent: number) => void,
  isRetry = false,
): Promise<T> {
  const form = new FormData();
  form.append('file', file);
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === '') continue;
    form.append(key, String(value));
  }

  const result = await new Promise<{ status: number; text: string }>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('POST', buildUrl(path));
    const token = tokenStore.access;
    if (token) request.setRequestHeader('Authorization', `Bearer ${token}`);

    if (onProgress) {
      request.upload.addEventListener('progress', (event) => {
        if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
      });
    }
    request.addEventListener('load', () =>
      resolve({ status: request.status, text: request.responseText }),
    );
    request.addEventListener('error', () => reject(new Error('network')));
    request.addEventListener('abort', () => reject(new Error('aborted')));
    request.send(form);
  }).catch(() => {
    throw new ApiError(0, { message: 'The upload could not reach the server.', code: 'NETWORK' });
  });

  if (result.status === 401 && !isRetry) {
    refreshPromise ??= refreshAccessToken().finally(() => {
      refreshPromise = null;
    });
    if (await refreshPromise) return uploadFile<T>(path, file, fields, onProgress, true);
    tokenStore.clear();
    onSessionExpired();
    throw new ApiError(401, {
      message: 'Your session has expired. Please sign in again.',
      code: 'UNAUTHORIZED',
    });
  }

  let payload: { data: T; error: ApiErrorBody | null };
  try {
    payload = JSON.parse(result.text);
  } catch {
    throw new ApiError(result.status, {
      message: 'The server returned an unexpected response.',
      code: 'BAD_RESPONSE',
    });
  }
  if (result.status >= 400 || payload.error) {
    throw new ApiError(
      result.status,
      payload.error ?? { message: 'The upload failed.', code: 'UNKNOWN' },
    );
  }
  return payload.data;
}

/**
 * Fetches the bytes with the bearer token attached and hands back a blob URL
 * — for a plain `<a href>` or `<img src>`, which cannot carry an auth header
 * of their own. The caller owns the URL and must revoke it when done.
 */
async function fetchBlobUrl(path: string): Promise<string> {
  const token = tokenStore.access;
  const response = await fetch(buildUrl(path), {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) {
    throw new ApiError(response.status, {
      message: 'That file could not be fetched.',
      code: 'DOWNLOAD_FAILED',
    });
  }
  const blob = await response.blob();
  return URL.createObjectURL(blob);
}

/**
 * Downloads through fetch rather than a plain link so the bearer token travels
 * with the request, then hands the blob to the browser to save.
 */
async function downloadFile(path: string, fallbackName: string): Promise<void> {
  const url = await fetchBlobUrl(path);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fallbackName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
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
  upload: uploadFile,
  download: downloadFile,
  blobUrl: fetchBlobUrl,
};

/** Shape returned by every paginated list endpoint. */
export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
