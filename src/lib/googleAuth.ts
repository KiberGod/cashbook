import { AppError } from './errors';
import { readJson, writeJson } from './storage';

/**
 * Browser-only OAuth via Google Identity Services (token model).
 * No client secret is involved: the Client ID is a public identifier and is
 * restricted to the authorised JavaScript origins configured in Google Cloud.
 */

const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const GIS_SRC = 'https://accounts.google.com/gsi/client';
const EXPIRY_MARGIN_MS = 60_000;

export const CLIENT_ID: string = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '';

interface TokenResponse {
  access_token?: string;
  expires_in?: number | string;
  error?: string;
  error_description?: string;
}

interface TokenClient {
  callback: (r: TokenResponse) => void;
  error_callback?: (e: { type: string }) => void;
  requestAccessToken: (overrides?: { prompt?: string }) => void;
}

interface GoogleOAuth2 {
  initTokenClient: (config: {
    client_id: string;
    scope: string;
    callback: (r: TokenResponse) => void;
    error_callback?: (e: { type: string }) => void;
  }) => TokenClient;
  hasGrantedAllScopes: (r: TokenResponse, ...scopes: string[]) => boolean;
  revoke: (token: string, done?: () => void) => void;
}

declare global {
  interface Window {
    google?: { accounts: { oauth2: GoogleOAuth2 } };
  }
}

interface StoredToken {
  token: string;
  expiresAt: number;
}

let gisPromise: Promise<GoogleOAuth2> | null = null;
let client: TokenClient | null = null;

export function loadGis(): Promise<GoogleOAuth2> {
  if (window.google?.accounts?.oauth2) return Promise.resolve(window.google.accounts.oauth2);
  gisPromise ??= new Promise<GoogleOAuth2>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = GIS_SRC;
    script.async = true;
    script.onload = () =>
      window.google?.accounts?.oauth2
        ? resolve(window.google.accounts.oauth2)
        : reject(new AppError('network'));
    script.onerror = () => {
      gisPromise = null;
      script.remove();
      reject(new AppError('network'));
    };
    document.head.appendChild(script);
  });
  return gisPromise;
}

export function getValidToken(): string | null {
  const t = readJson<StoredToken | null>('token', null);
  return t && t.expiresAt - EXPIRY_MARGIN_MS > Date.now() ? t.token : null;
}

/**
 * Opens the Google sign-in popup. Call it synchronously from a click handler
 * (after GIS has been preloaded), otherwise browsers may block the popup.
 */
export function requestToken(): Promise<string> {
  if (!CLIENT_ID) return Promise.reject(new AppError('noClientId'));

  const run = (oauth2: GoogleOAuth2) =>
    new Promise<string>((resolve, reject) => {
      client ??= oauth2.initTokenClient({ client_id: CLIENT_ID, scope: SCOPE, callback: () => {} });
      client.callback = (r) => {
        if (r.error || !r.access_token) {
          reject(new AppError(r.error === 'access_denied' ? 'scopeDenied' : 'auth', r.error_description));
          return;
        }
        if (!oauth2.hasGrantedAllScopes(r, SCOPE)) {
          reject(new AppError('scopeDenied'));
          return;
        }
        const expiresIn = Number(r.expires_in) || 3600;
        writeJson('token', { token: r.access_token, expiresAt: Date.now() + expiresIn * 1000 });
        resolve(r.access_token);
      };
      client.error_callback = (e) =>
        reject(new AppError(e.type === 'popup_failed_to_open' ? 'popupBlocked' : 'popupClosed'));
      client.requestAccessToken({ prompt: '' });
    });

  // Fast path keeps the call inside the user gesture.
  const ready = window.google?.accounts?.oauth2;
  return ready ? run(ready) : loadGis().then(run);
}

export function signOut() {
  const t = readJson<StoredToken | null>('token', null);
  writeJson('token', null);
  if (t && window.google?.accounts?.oauth2) window.google.accounts.oauth2.revoke(t.token);
}

export function forgetToken() {
  writeJson('token', null);
}
