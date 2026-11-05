/**
 * Google sign-in hand-off.
 *
 * Before leaving for Google we store a random `state` in this tab's
 * sessionStorage and send it to the API. After Google, the API sends the
 * browser back to /auth/callback with a one-time code and that same state in
 * the URL fragment. The callback page only redeems a code whose state matches
 * the one this tab stored, so a link carrying someone else's code can't sign
 * this browser into their account.
 */
const STATE_KEY = 'scopit-oauth-state';

function randomState(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  // base64url, no padding: only [A-Za-z0-9_-], which the API accepts
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

const RETURN_KEY = 'scopit-oauth-return';

/** Only in-app paths; never another origin (open redirect). */
export function safeReturnPath(path: unknown): string | null {
  if (typeof path !== 'string') return null;
  if (!path.startsWith('/app/') || path.startsWith('//') || path.includes('\\')) return null;
  return path;
}

/**
 * URL to send the browser to for "Continue with Google".
 * `returnTo` is where to land after signing in; `reauth` makes Google ask for
 * the account's password even if the browser is already signed in (used when
 * a device comes back from a customer, so they can't sign in as the employee).
 */
export function googleSignInUrl(
  apiUrl: string,
  opts: { returnTo?: string | null; reauth?: boolean } = {},
): string {
  const state = randomState();
  try {
    sessionStorage.setItem(STATE_KEY, state);
    const returnTo = safeReturnPath(opts.returnTo);
    if (returnTo) sessionStorage.setItem(RETURN_KEY, returnTo);
    else sessionStorage.removeItem(RETURN_KEY);
  } catch {
    // Storage blocked (rare private modes): the callback will fail safely.
  }
  const reauth = opts.reauth ? '&reauth=1' : '';
  return `${apiUrl}/auth/google?state=${encodeURIComponent(state)}${reauth}`;
}

/** Where to go after the Google round trip (read once). */
export function takeStoredReturnTo(): string | null {
  try {
    const value = sessionStorage.getItem(RETURN_KEY);
    sessionStorage.removeItem(RETURN_KEY);
    return safeReturnPath(value);
  } catch {
    return null;
  }
}

/** The state this tab stored before leaving for Google (read once). */
export function takeStoredGoogleState(): string | null {
  try {
    const value = sessionStorage.getItem(STATE_KEY);
    sessionStorage.removeItem(STATE_KEY);
    return value;
  } catch {
    return null;
  }
}
