import { test, expect } from '@playwright/test';
import type {} from './fixtures/desktop';

test.beforeEach(async ({ page }) => {
  await page.route('**/src/main.tsx*', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body: `import '/tests/fixtures/desktop.ts';\n${await response.text()}`,
    });
  });
});
const newEntry = {
  path: '2026-11-November/11.01.26.txt',
  name: '11.01.26.txt',
  month: '2026-11',
  content: 'SUNDAY\n8/10\n===============\nA new November memory.',
};

test('new entries update navigation and search without moving the current reader', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByText('Live journal', { exact: true })).toBeVisible();
  await page
    .getByRole('button', { name: 'Bookmark entry', exact: true })
    .click();
  await page.locator('.reader-scroll').evaluate((el) => (el.scrollTop = 200));
  const scroll = await page
    .locator('.reader-scroll')
    .evaluate((el) => el.scrollTop);
  await page.evaluate((entry) => window.journalTest.add(entry), newEntry);
  await expect(
    page.getByRole('button', { name: 'November 1', exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole('heading', { name: 'October 2', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Remove bookmark', exact: true }),
  ).toBeVisible();
  expect(
    await page.locator('.reader-scroll').evaluate((el) => el.scrollTop),
  ).toBe(scroll);
  await expect(
    page.getByRole('button', {
      name: 'Next month: November 2026',
      exact: true,
    }),
  ).toBeEnabled();
  await page.keyboard.press('Meta+k');
  await page
    .getByRole('textbox', { name: 'Search entries and commands' })
    .fill('November memory');
  await expect(page.getByRole('dialog').getByRole('option')).toHaveCount(1);
  await page
    .getByRole('textbox', { name: 'Search entries and commands' })
    .press('Enter');
  await expect(
    page.getByRole('heading', { name: 'November 1', exact: true }),
  ).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.journalTest.subscriptions))
    .toBe(1);
});

test('edits update the open original text and deletion selects a remaining entry', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByText('Live journal', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Show original text' }).click();
  await page.evaluate(() =>
    window.journalTest.update(
      '10.02.26.txt',
      'FRIDAY\n9/10\n===============\nA freshly edited thought.',
    ),
  );
  await expect(page.locator('.raw-text')).toContainText(
    'A freshly edited thought.',
  );
  await page.evaluate(() => window.journalTest.remove('10.02.26.txt'));
  await expect(
    page.getByRole('heading', { name: 'October 1', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.reader-footer')).toContainText('1 of 1');
});

test('polling discovers new files if the native watcher is unavailable', async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.watchUnavailable = true;
  });
  await page.clock.install();
  await page.goto('/');
  await expect(
    page.getByText('Auto-refresh · 1 min', { exact: true }),
  ).toBeVisible();
  await page.evaluate(
    (entry) => window.journalTest.add(entry, false),
    newEntry,
  );
  await page.clock.fastForward(60_000);
  await expect(
    page.getByRole('button', { name: 'November 1', exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole('heading', { name: 'October 2', exact: true }),
  ).toBeVisible();
});

test('refresh leaves the calendar on the year being browsed', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByText('Live journal', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Calendar', exact: true }).click();
  await page.getByLabel('Calendar year').selectOption('2024');
  await page.evaluate((entry) => window.journalTest.add(entry), newEntry);
  await expect(
    page.getByRole('button', { name: 'Journal 25', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'A life in days.' }),
  ).toBeVisible();
  await expect(page.getByLabel('Calendar year')).toHaveValue('2024');
});
