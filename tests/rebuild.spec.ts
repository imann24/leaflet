import { test, expect } from '@playwright/test';
import { emit } from '@tauri-apps/api/event';
import type {} from './fixtures/desktop';

test.beforeEach(async ({ page }) => {
  await page.route('**/src/main.tsx*', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body: `import '/tests/fixtures/desktop.ts';\n${await response.text()}`,
    });
  });
  await page.goto('/');
});

test('rebuild remembers the workspace and stays busy across closing and reopening', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Rebuild app', exact: true }).click();
  await expect(
    page.getByLabel('Workspace folder', { exact: true }),
  ).toHaveValue('/fictional/leaflet');
  await page.getByRole('button', { name: 'Choose workspace folder' }).click();
  await expect(
    page.getByLabel('Workspace folder', { exact: true }),
  ).toHaveValue('/fictional/Leaflet workspace');
  await page.getByRole('button', { name: 'Rebuild & restart' }).click();
  await expect(
    page.getByRole('button', { name: 'Rebuilding…' }),
  ).toBeDisabled();
  await expect(
    page.getByLabel('Workspace folder', { exact: true }),
  ).toBeDisabled();
  await expect
    .poll(() => page.evaluate(() => window.journalTest.rebuildCalls))
    .toBe(1);
  expect(await page.evaluate(() => window.journalTest.rebuildWorkspace)).toBe(
    '/fictional/Leaflet workspace',
  );
  await page.getByRole('button', { name: 'Keep reading' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Rebuild app', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Rebuilding…' }),
  ).toBeDisabled();
  await page.evaluate(() =>
    window.journalTest.setRebuild({
      phase: 'failed',
      error: 'Build failed. The current app is unchanged.',
      log: 'error: compilation failed',
    }),
  );
  await expect(page.getByRole('alert')).toContainText('Build failed');
  await expect(
    page.getByText('error: compilation failed', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Rebuild & restart' }),
  ).toBeEnabled();
  await page.getByRole('button', { name: 'Rebuild & restart' }).click();
  await expect
    .poll(() => page.evaluate(() => window.journalTest.rebuildCalls))
    .toBe(2);
});

test('native rebuild menu event opens the rebuild dialog', async ({ page }) => {
  await expect(
    page.getByRole('button', { name: 'Rebuild app', exact: true }),
  ).toBeVisible();
  await emit('open-rebuild');
  await expect(
    page.getByRole('heading', { name: 'Rebuild app', exact: true }),
  ).toBeVisible();
});

test('command palette opens rebuild and unavailable runtimes cannot start it', async ({
  page,
}) => {
  await page.evaluate(() =>
    window.journalTest.setRebuild({
      unavailableReason: 'Open an installed Leaflet.app to rebuild it.',
    }),
  );
  await page.keyboard.press('Meta+k');
  await page
    .getByRole('textbox', { name: 'Search entries and commands' })
    .fill('>rebuild');
  await page.getByRole('dialog').getByRole('option').click();
  await expect(
    page.getByRole('heading', { name: 'Rebuild app' }),
  ).toBeVisible();
  await expect(
    page.getByText('Open an installed Leaflet.app to rebuild it.'),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Rebuild & restart' }),
  ).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('status polling recovers from an initial failure and clears only its own error', async ({
  page,
}) => {
  await page.evaluate(() => window.journalTest.failStatusPolls(100));
  await page.getByRole('button', { name: 'Rebuild app', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText(
    'Status temporarily unavailable',
  );
  await page.evaluate(() => window.journalTest.failStatusPolls(0));
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(
    page.getByLabel('Workspace folder', { exact: true }),
  ).toHaveValue('/fictional/leaflet');
  await expect(
    page.getByRole('button', { name: 'Rebuild & restart' }),
  ).toBeEnabled();

  await page.evaluate(() => {
    window.journalTest.failRebuild('Could not start the rebuild worker');
    window.journalTest.failStatusPolls(1);
  });
  await page.getByRole('button', { name: 'Rebuild & restart' }).click();
  await expect(page.getByRole('alert')).toContainText(
    'Could not start the rebuild worker',
  );
  const calls = await page.evaluate(() => window.journalTest.statusCalls);
  await expect
    .poll(() => page.evaluate(() => window.journalTest.statusCalls))
    .toBeGreaterThanOrEqual(calls + 2);
  await expect(page.getByRole('alert')).toContainText(
    'Could not start the rebuild worker',
  );
});

test('workspace comes from the native picker, not local storage or build arguments', async ({
  page,
}) => {
  await page.evaluate(() => {
    localStorage.setItem(
      'leaflet:buildWorkspace',
      JSON.stringify('/untrusted/workspace'),
    );
    window.journalTest.setRebuild({ workspace: '' });
  });
  await page.getByRole('button', { name: 'Rebuild app', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Rebuild & restart' }),
  ).toBeDisabled();
  await expect(
    page.getByLabel('Workspace folder', { exact: true }),
  ).not.toBeEditable();
  await page.getByRole('button', { name: 'Choose workspace folder' }).click();
  await expect(
    page.getByLabel('Workspace folder', { exact: true }),
  ).toHaveValue('/fictional/Leaflet workspace');
  await page.getByRole('button', { name: 'Rebuild & restart' }).click();
  await expect
    .poll(() => page.evaluate(() => window.journalTest.rebuildCalls))
    .toBe(1);
  expect(
    await page.evaluate(() => window.journalTest.rebuildArgs),
  ).not.toHaveProperty('workspace');
});
