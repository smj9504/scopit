/**
 * Auth helper — logs in via API and injects auth state into localStorage
 * so Playwright tests skip the login UI.
 */
import { Page } from '@playwright/test';

const API_URL = 'http://localhost:8001/api';

export interface TestUser {
  email: string;
  password: string;
}

// Default test user — must exist in the local DB
export const TEST_USER: TestUser = {
  email: 'test@scopeit.com',
  password: 'test1234',
};

export async function loginViaAPI(page: Page, user: TestUser = TEST_USER) {
  // Call login API directly
  const response = await page.request.post(`${API_URL}/auth/login`, {
    data: { email: user.email, password: user.password },
  });

  if (!response.ok()) {
    const body = await response.text();
    throw new Error(`Login failed (${response.status()}): ${body}`);
  }

  const data = await response.json();

  // Inject auth state into localStorage (Zustand persist format)
  const authState = {
    state: {
      user: data.user,
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      isAuthenticated: true,
      isLoading: false,
    },
    version: 0,
  };

  await page.addInitScript((stateJson: string) => {
    window.localStorage.setItem('scopeit-auth', stateJson);
  }, JSON.stringify(authState));
}
