/**
 * Packout E2E Tests
 *
 * Tests the full packout workflow:
 * 1. Mode picker shows Packout option
 * 2. PackoutTab renders with 3-step wizard
 * 3. Room add/edit with box counts and non-boxable items
 * 4. Detail level toggle (lump sum / detailed)
 * 5. Calculate produces estimate and opens editor
 */
import { test, expect } from '@playwright/test';
import { loginViaAPI } from './auth.setup';

// Helper: open mode picker and select Packout
async function openPackout(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: /new/i }).click();
  await page.getByText('Packout', { exact: true }).click();
}

test.describe('Packout Tool', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
    await page.goto('/app/tools/packing');
    await page.waitForLoadState('networkidle');
  });

  test('mode picker shows Packout card', async ({ page }) => {
    await page.getByRole('button', { name: /new/i }).click();

    // Mode picker modal should show 3 options
    await expect(page.getByText('Quick Estimate', { exact: true })).toBeVisible();
    await expect(page.getByText('Photo AI', { exact: true })).toBeVisible();
    await expect(page.getByText('Packout', { exact: true })).toBeVisible();
    await expect(page.getByText('Box counts, non-boxable items')).toBeVisible();
  });

  test('selecting Packout opens wizard with 3 steps', async ({ page }) => {
    await openPackout(page);

    // Should show step titles in the Steps component
    const steps = page.locator('.ant-steps-item-title');
    await expect(steps.filter({ hasText: 'Details' })).toBeVisible();
    await expect(steps.filter({ hasText: 'Rooms' })).toBeVisible();
    await expect(steps.filter({ hasText: 'Settings' })).toBeVisible();

    // Header should show Packout tag
    await expect(page.locator('.ant-tag').filter({ hasText: 'Packout' })).toBeVisible();
  });

  test('detail level toggle switches between lump sum and detailed', async ({ page }) => {
    await openPackout(page);

    // Default should be "Detailed"
    await expect(page.getByText('Itemize each non-boxable item')).toBeVisible();

    // Switch to Lump Sum
    await page.locator('.ant-radio-button-wrapper').filter({ hasText: 'Lump Sum' }).click();
    await expect(page.getByText('Simple large-item count')).toBeVisible();
  });

  test('can add room and set box counts', async ({ page }) => {
    await openPackout(page);

    // Go to Rooms step
    await page.getByRole('button', { name: 'Next' }).click();

    // Add a room
    await page.getByRole('button', { name: /custom/i }).click();

    // Should see room card with box count inputs
    await expect(page.getByText('Boxes', { exact: true })).toBeVisible();
    await expect(page.getByText('Floor Coverage', { exact: true })).toBeVisible();
  });

  test('lump sum mode shows large item count input', async ({ page }) => {
    await openPackout(page);

    // Switch to lump sum
    await page.locator('.ant-radio-button-wrapper').filter({ hasText: 'Lump Sum' }).click();

    // Go to Rooms step
    await page.getByRole('button', { name: 'Next' }).click();

    // Add room
    await page.getByRole('button', { name: /custom/i }).click();

    // Should see "Large Items" input
    await expect(page.getByText('Large Items (non-boxable)')).toBeVisible();
  });

  test('detailed mode shows non-boxable item form', async ({ page }) => {
    await openPackout(page);

    // Go to Rooms step
    await page.getByRole('button', { name: 'Next' }).click();

    // Add room
    await page.getByRole('button', { name: /custom/i }).click();

    // Should show "Non-Boxable Items" header
    await expect(page.getByText('Non-Boxable Items', { exact: true })).toBeVisible();

    // Add a non-boxable item
    await page.getByRole('button', { name: 'Add Item' }).click();

    // Should show the item row with type select
    await expect(page.locator('.ant-select').first()).toBeVisible();
  });

  test('job settings step shows storage and crew controls', async ({ page }) => {
    await openPackout(page);

    // Go to Rooms → Settings
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByRole('button', { name: 'Next' }).click();

    // Should show job settings
    await expect(page.getByText('Storage Mode')).toBeVisible();
    await expect(page.getByText('Repair Duration')).toBeVisible();
    await expect(page.getByText('On-Property Storage %')).toBeVisible();
    await expect(page.getByText('Crew Size')).toBeVisible();
  });

  test('calculate button requires at least one room', async ({ page }) => {
    await openPackout(page);

    // Go straight to Settings (no rooms)
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByRole('button', { name: 'Next' }).click();

    // Calculate should be disabled
    const calcBtn = page.getByRole('button', { name: /calculate/i });
    await expect(calcBtn).toBeDisabled();
  });

  test('full packout flow: add room → calculate → view estimate', async ({ page }) => {
    await openPackout(page);

    // Switch to lump sum for simplicity
    await page.locator('.ant-radio-button-wrapper').filter({ hasText: 'Lump Sum' }).click();

    // Step 1 → Step 2
    await page.getByRole('button', { name: 'Next' }).click();

    // Add a room
    await page.getByRole('button', { name: /custom/i }).click();

    // Set large item count — the InputNumber is inside the div after the label
    const largeItemBlock = page.getByText('Large Items (non-boxable)').locator('xpath=ancestor::div[1]');
    await largeItemBlock.getByRole('spinbutton').fill('5');

    // Set some medium boxes — use the 2nd spinbutton in the Boxes section
    // Box order: Small(0), Medium(1), Large(2), Wardrobe(3), ...
    const boxesSection = page.getByText('Boxes', { exact: true }).locator('xpath=ancestor::div[1]');
    await boxesSection.getByRole('spinbutton').nth(1).fill('8');

    // Step 2 → Step 3
    await page.getByRole('button', { name: 'Next' }).click();

    // Calculate
    const calcBtn = page.getByRole('button', { name: /calculate/i });
    await expect(calcBtn).toBeEnabled();
    await calcBtn.click();

    // Wait for estimate result — should show success message
    await expect(page.getByText(/packout estimate calculated/i)).toBeVisible({ timeout: 15_000 });

    // Estimate editor modal should open with Pack-Out Labor section
    await expect(page.getByText('Pack-Out Labor')).toBeVisible({ timeout: 5_000 });
  });

  test('back button returns to list view', async ({ page }) => {
    await openPackout(page);

    // Click the Back button in the header (not the wizard Back)
    await page.locator('button').filter({ hasText: 'Back' }).first().click();

    // Should return to list — use tab role to be specific
    await expect(page.getByRole('tab', { name: 'Estimates' })).toBeVisible();
  });
});
