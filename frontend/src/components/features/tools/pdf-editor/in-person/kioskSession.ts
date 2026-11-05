/**
 * Scopit - In-person signing: the handed-over visit, kept in this tab
 *
 * Handing over signs the employee out and loads the signer's page
 * (/sign-in-person/kiosk) fresh. Everything that page needs -- the kiosk
 * token and the visit it covers, the signer's progress, the signed result --
 * lives in this tab's sessionStorage, so reloading the page (a pull-down, a
 * dropped connection) picks the visit up where it was. sessionStorage is
 * per tab and gone when the tab closes; the kiosk token itself only reaches
 * this visit and expires within 2 hours.
 */
import type { Handoff } from './kioskApi';
import type { SignedVisit } from './inPersonApi';

const KIOSK_KEY = 'scopit-kiosk';
/** The employee's draft of the visit (SignInPersonPage), kept for an unsigned hand-back */
export const IN_PERSON_DRAFT_KEY = 'scopit-in-person-draft';
/** The signer's page */
export const KIOSK_PATH = '/sign-in-person/kiosk';
/** Where the employee picks the visit up again if it's handed back unsigned */
export const RESUME_PATH = '/app/sign-in-person?step=handoff';

/** What the signer has done so far on the signing screen */
export interface SignProgress {
  names: Record<string, string>;
  me: string | null;
  marks: Record<string, { image: string; mode: 'draw' | 'type'; font?: string }>;
  placed: Record<string, boolean>;
}

export interface StoredKiosk {
  handoff: Handoff;
  /** The device's date when it was handed over */
  today: string;
  /** Where the employee lands after signing back in once it's signed */
  returnTo: string;
  docIndex: number;
  progress?: SignProgress;
  result?: SignedVisit;
}

export function loadKiosk(): StoredKiosk | null {
  try {
    const raw = sessionStorage.getItem(KIOSK_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as StoredKiosk;
    if (!value?.handoff?.token || !value.handoff.form || typeof value.today !== 'string') return null;
    return value;
  } catch {
    return null;
  }
}

/** Returns false if storage is unavailable (the visit then can't survive a reload) */
export function saveKiosk(value: StoredKiosk): boolean {
  try {
    sessionStorage.setItem(KIOSK_KEY, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function updateKiosk(patch: Partial<StoredKiosk>): void {
  const current = loadKiosk();
  if (current) saveKiosk({ ...current, ...patch });
}

export function clearKiosk(): void {
  try {
    sessionStorage.removeItem(KIOSK_KEY);
  } catch {
    // nothing stored
  }
}

export function clearInPersonDraft(): void {
  try {
    sessionStorage.removeItem(IN_PERSON_DRAFT_KEY);
  } catch {
    // nothing stored
  }
}

export const kioskExpired = (handoff: Handoff) => {
  const ends = Date.parse(handoff.expiresAt);
  return Number.isFinite(ends) && ends <= Date.now();
};

/**
 * To the sign-in page, as a fresh page load: nothing of the visit or any
 * session survives in memory. The router reads the sign-in page's state
 * (where to go after, whose email) from the history entry; `reauth` makes
 * "Continue with Google" ask for the password, so a signer can't get in
 * through a Google session already open in this browser.
 */
export function goToSignIn(state: { returnTo: string; email?: string }): void {
  const entry = (window.history.state ?? {}) as Record<string, unknown>;
  window.history.replaceState({ ...entry, usr: { ...state, reauth: true } }, '', '/login');
  window.location.reload();
}
