import { test, expect } from '@playwright/test';
test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'October 2', exact: true }),
  ).toBeVisible();
});
test('pages through entries and stops at the end of the archive', async ({
  page,
}) => {
  await expect(
    page.getByRole('button', { name: 'Next entry', exact: true }),
  ).toBeDisabled();
  await page
    .getByRole('button', { name: 'Previous entry', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'October 1', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Previous entry', exact: true }),
  ).toBeDisabled();
  await page.keyboard.press('Alt+ArrowRight');
  await expect(
    page.getByRole('heading', { name: 'October 2', exact: true }),
  ).toBeVisible();
});
test('calendar jumps across years and opens a day', async ({ page }) => {
  await page.getByRole('button', { name: 'Calendar', exact: true }).click();
  await page.getByLabel('Calendar year').selectOption('2024');
  await page
    .getByRole('button', { name: 'October 8, 2024, 1 entries', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'October 8', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.entry-meta')).toContainText('2024');
});
test('Cmd+K opens filename search, keyboard selection, and quick commands', async ({
  page,
}) => {
  await page.keyboard.press('Meta+k');
  const search = page.getByRole('textbox', {
    name: 'Search entries and commands',
  });
  await search.fill('9.13.26');
  await expect(page.getByRole('dialog').getByRole('option')).toHaveCount(1);
  await search.press('Enter');
  await expect(
    page.getByRole('heading', { name: 'September 13', exact: true }),
  ).toBeVisible();
  await page.keyboard.press('Meta+k');
  await search.fill('>open calendar');
  await search.press('Enter');
  await expect(
    page.getByRole('heading', { name: 'A life in days.' }),
  ).toBeVisible();
});
test('bookmarks and the last-read entry survive a reload', async ({ page }) => {
  await page
    .getByRole('button', { name: 'Previous entry', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Bookmark entry', exact: true })
    .click();
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'October 1', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: /^Bookmarks/ }).click();
  await expect(page.locator('.entry-card')).toHaveCount(1);
  await page
    .getByRole('button', { name: 'Remove bookmark', exact: true })
    .click();
  await expect(page.locator('.entry-list')).toContainText('Save an entry');
});
test('focus, original text, and theme controls work', async ({ page }) => {
  await page.getByRole('button', { name: 'Focus mode', exact: true }).click();
  await expect(page.locator('.sidebar')).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(page.locator('.sidebar')).toBeVisible();
  await page.getByRole('button', { name: 'Show original text' }).click();
  await expect(page.locator('.raw-text')).toContainText('8/10');
  await page.getByRole('button', { name: 'Show rendered entry' }).click();
  await expect(page.locator('.prose h2')).toHaveText(
    'Things I want to remember',
  );
  await page.getByRole('button', { name: 'Use dark mode' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});
test('demo has no runtime errors or overflowing main layout', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'October 2', exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
  await page.screenshot({ path: 'test-results/reader.png', fullPage: true });
});

test('dark mode updates the whole reader and persists across reloads', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Use dark mode' }).click();
  await expect(page.locator('html')).toHaveCSS(
    'background-color',
    'rgb(32, 37, 31)',
  );
  await expect(page.locator('.app')).toHaveCSS(
    'background-color',
    'rgb(32, 37, 31)',
  );
  await expect(page.locator('.entry-content h1')).toHaveCSS(
    'color',
    'rgb(222, 223, 212)',
  );
  await expect(page.locator('.brand')).toHaveCSS('color', 'rgb(222, 223, 212)');
  await expect(page.locator('.entry-card.selected strong')).toHaveCSS(
    'color',
    'rgb(222, 223, 212)',
  );
  await expect(page.locator('.prose')).toHaveCSS('color', 'rgb(222, 223, 212)');
  await expect(page.locator('html')).toHaveCSS('color-scheme', 'dark');
  await page.screenshot({
    path: 'test-results/dark-reader.png',
    fullPage: true,
  });
  await page.reload();
  await expect(page.locator('.app')).toHaveCSS(
    'background-color',
    'rgb(32, 37, 31)',
  );
  await page.getByRole('button', { name: 'Calendar', exact: true }).click();
  await expect(page.locator('.month-card').first()).toHaveCSS(
    'background-color',
    'rgb(35, 41, 32)',
  );
  await page.screenshot({
    path: 'test-results/dark-calendar.png',
    fullPage: true,
  });
  await page.keyboard.press('Meta+k');
  await expect(page.getByRole('dialog')).toHaveCSS(
    'background-color',
    'rgb(32, 37, 31)',
  );
  await expect(page.getByRole('dialog')).toHaveCSS(
    'color',
    'rgb(222, 223, 212)',
  );
  await page.screenshot({
    path: 'test-results/dark-palette.png',
    fullPage: true,
  });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Use light mode' }).click();
  await expect(page.locator('.app')).toHaveCSS(
    'background-color',
    'rgb(251, 250, 247)',
  );
  await expect(page.locator('.app')).toHaveCSS('color', 'rgb(52, 60, 50)');
  await expect(page.locator('html')).toHaveCSS('color-scheme', 'light');
});

test('renders the daily reflection as three cards while preserving the original', async ({
  page,
}) => {
  await page
    .getByRole('button', { name: 'Previous entry', exact: true })
    .click();
  const reflection = page.getByRole('region', {
    name: 'The 3 and 3 reflection',
  });
  await expect(reflection).toBeVisible();
  await expect(reflection.getByRole('listitem')).toHaveCount(9);
  for (const name of ['Gratitude', 'Forgiveness', 'Curiosity']) {
    await expect(
      reflection.getByRole('heading', { name, exact: true }),
    ).toBeVisible();
  }
  await expect(page.locator('.prose')).not.toContainText('3 x Gratitude');
  await expect(page.locator('.prose')).toContainText(
    'Today felt like a fresh page.',
  );
  await page.screenshot({
    path: 'test-results/reflection-light.png',
    animations: 'disabled',
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Use dark mode' }).click();
  await expect(page.locator('.reflection-gratitude')).toHaveCSS(
    'background-color',
    'rgb(44, 43, 32)',
  );
  await expect(page.locator('.reflection-gratitude li').first()).toHaveCSS(
    'color',
    'rgb(222, 223, 212)',
  );
  await page.screenshot({
    path: 'test-results/reflection-dark.png',
    animations: 'disabled',
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Show original text' }).click();
  await expect(page.locator('.raw-text')).toContainText('3 x Gratitude');
  await expect(page.locator('.raw-text')).toContainText('===============');
  await expect(reflection).toHaveCount(0);
});

test('hides skipped exercise banners only in rendered mode', async ({
  page,
}) => {
  await page.keyboard.press('Meta+k');
  const search = page.getByRole('textbox', {
    name: 'Search entries and commands',
  });
  await search.fill('9.30.26');
  await search.press('Enter');
  await expect(
    page.getByRole('heading', { name: 'September 30', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.prose')).not.toContainText('SKIPPED');
  await expect(page.locator('.prose')).not.toContainText('===============');
  await expect(page.locator('.prose')).toContainText(
    'A little room to breathe.',
  );
  await expect(page.locator('.entry-card.selected')).not.toContainText(
    'SKIPPED',
  );
  await page.getByRole('button', { name: 'Show original text' }).click();
  await expect(page.locator('.raw-text')).toContainText('3x3 >>> SKIPPED');
});

test('quick search submission uses the new query and resets a previous selection', async ({
  page,
}) => {
  await page.keyboard.press('Meta+k');
  const search = page.getByRole('textbox', {
    name: 'Search entries and commands',
  });
  await search.press('ArrowDown');
  await search.press('ArrowDown');
  // Intentionally submit without waiting for a result: this used to run a stale command.
  await search.fill('9.30.26');
  await search.press('Enter');
  await expect(
    page.getByRole('heading', { name: 'September 30', exact: true }),
  ).toBeVisible();
  await page.keyboard.press('Meta+k');
  await search.fill('no matching journal entry');
  await search.press('ArrowDown');
  await search.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();
  await search.fill('>open calendar');
  await search.press('Enter');
  await expect(
    page.getByRole('heading', { name: 'A life in days.' }),
  ).toBeVisible();
});

test('next month is clearly labeled and opens its first entry', async ({
  page,
}) => {
  await page.keyboard.press('Meta+k');
  const search = page.getByRole('textbox', {
    name: 'Search entries and commands',
  });
  await search.fill('9.30.26');
  await search.press('Enter');
  const nextMonth = page.getByRole('button', {
    name: 'Next month: October 2026',
    exact: true,
  });
  await expect(nextMonth).toBeEnabled();
  await expect(nextMonth).toHaveText('Next monthOctober 2026');
  await page.screenshot({
    path: 'test-results/next-month.png',
    animations: 'disabled',
    fullPage: true,
  });
  await nextMonth.click();
  await expect(
    page.getByRole('heading', { name: 'October 1', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.entry-column-heading h2')).toHaveText(
    'October 2026',
  );
  await expect(page.locator('.reader-footer')).toContainText('1 of 2');
  await expect(
    page.getByRole('button', { name: 'Next entry', exact: true }),
  ).toBeEnabled();
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'October 1', exact: true }),
  ).toBeVisible();
});

test('keyboard paging crosses year boundaries and skips empty months', async ({
  page,
}) => {
  await page.keyboard.press('Meta+k');
  const search = page.getByRole('textbox', {
    name: 'Search entries and commands',
  });
  await search.fill('10.30.25');
  await search.press('Enter');
  await expect(
    page.getByRole('button', {
      name: 'Next available month: September 2026',
      exact: true,
    }),
  ).toBeEnabled();
  await page.keyboard.press('Alt+ArrowRight');
  await expect(
    page.getByRole('heading', { name: 'September 2', exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('Archive year')).toHaveValue('2026');
  await expect(page.locator('.entry-column-heading h2')).toHaveText(
    'September 2026',
  );
  await expect(page.locator('.reader-footer')).toContainText('1 of 9');
});

test('next stays inside the bookmark collection at a month boundary', async ({
  page,
}) => {
  await page.keyboard.press('Meta+k');
  const search = page.getByRole('textbox', {
    name: 'Search entries and commands',
  });
  await search.fill('9.30.26');
  await search.press('Enter');
  await page
    .getByRole('button', { name: 'Bookmark entry', exact: true })
    .click();
  await page.getByRole('button', { name: /^Bookmarks/ }).click();
  await expect(
    page.getByRole('button', { name: 'Next entry', exact: true }),
  ).toBeDisabled();
  await expect(page.getByRole('button', { name: /Next month:/ })).toHaveCount(
    0,
  );
  await page.keyboard.press('Alt+ArrowRight');
  await expect(
    page.getByRole('heading', { name: 'September 30', exact: true }),
  ).toBeVisible();
});
