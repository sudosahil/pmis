/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Absolute origin of the PMIS API, e.g. https://pmis-api.onrender.com.
   * Leave unset when the site and the API share an origin — the dev server
   * proxies /api, and a single-host deployment serves both from one domain.
   */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
