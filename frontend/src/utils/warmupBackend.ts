/**
 * Scopit - Backend warmup helper
 */
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8001/api';
const HEALTH_URL = `${API_URL.replace(/\/api\/?$/, '')}/health`;

const FIRST_ATTEMPT_TIMEOUT_MS = 3000;
const RETRY_TIMEOUT_MS = 5000;
const RETRY_INTERVAL_MS = 2000;
const MAX_WAIT_MS = 75000;

const ping = async (timeoutMs: number): Promise<boolean> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(HEALTH_URL, { signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Render's free plan spins the API down when idle, so the first request after
 * a while triggers a ~30-50s cold start. Redirecting straight into that (e.g.
 * the Google OAuth handoff, which is a full-page navigation to the API
 * domain) makes the browser render Render's own "waking up" interstitial
 * instead of our UI. Polling /health first lets the caller show its own
 * loading state and only navigate once the backend is actually responding.
 */
export const warmupBackend = async (onWaking?: () => void): Promise<void> => {
  if (await ping(FIRST_ATTEMPT_TIMEOUT_MS)) return;

  onWaking?.();

  const deadline = Date.now() + MAX_WAIT_MS;
  while (Date.now() < deadline) {
    if (await ping(RETRY_TIMEOUT_MS)) return;
    await new Promise((resolve) => setTimeout(resolve, RETRY_INTERVAL_MS));
  }

  throw new Error('Backend did not respond in time');
};
