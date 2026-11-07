import { test, expect, type Page } from '@playwright/test';
import type {} from './fixtures/desktop';

const currentContent = `FRIDAY
8/10
===============
Lighthouse lighthouse LIGHTHOUSE.

A **formatted** _phrase_ stays readable.

Literal punctuation: \`[a-z]+.*?\` and \`[A-Z]+.*?\`.

The lamp and the post are separate words.

An [ordinary link](https://example.com) stays intact.`;
const previousContent = `THURSDAY
7/10
===============
Lighthouse begins here. Another lighthouse.

An elsewhere-only sentence.`;

const findInput = (page: Page) =>
  page.getByRole('textbox', { name: 'Find in entry', exact: true });
const marks = (page: Page) => page.locator('.prose mark[data-entry-match]');
const activeMarks = (page: Page) =>
  page.locator('.prose mark[data-entry-match][data-active="true"]');

async function openFind(page: Page, query: string) {
  await page
    .getByRole('button', { name: 'Find in entry', exact: true })
    .click();
  await expect(findInput(page)).toBeFocused();
  await findInput(page).fill(query);
}

async function expectMatchPosition(page: Page, current: number, total: number) {
  await expect(
    page.getByText(`${current} of ${total}`, { exact: true }),
  ).toBeVisible();
  await expect(marks(page)).toHaveCount(total);
  await expect(activeMarks(page)).toHaveCount(1);
  await expect(marks(page).nth(current - 1)).toHaveAttribute(
    'data-active',
    'true',
  );
}

test.beforeEach(async ({ page }) => {
  await page.route('**/src/main.tsx*', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body: `import '/tests/fixtures/desktop.ts';\n${await response.text()}`,
    });
  });
  await page.goto('/');
  await expect(page.getByText('Live journal', { exact: true })).toBeVisible();
  await page.evaluate(
    async ({ currentContent, previousContent }) => {
      await window.journalTest.update('10.02.26.txt', currentContent);
      await window.journalTest.update('10.01.26.txt', previousContent);
    },
    { currentContent, previousContent },
  );
  await expect(page.locator('.prose')).toContainText(
    'Lighthouse lighthouse LIGHTHOUSE.',
  );
});

test('find is literal, case-insensitive, and scoped to the current entry body', async ({
  page,
}) => {
  await openFind(page, 'lIgHtHoUsE');
  await expectMatchPosition(page, 1, 3);
  await expect(page.locator('mark[data-entry-match]')).toHaveCount(3);
  await expect(page.locator('.entry-list mark')).toHaveCount(0);

  await findInput(page).fill('[a-z]+.*?');
  await expectMatchPosition(page, 1, 2);
  await expect(marks(page)).toHaveText(['[a-z]+.*?', '[A-Z]+.*?']);

  // A filename/date, metadata, another entry, and separated words are not
  // matches in the current rendered body. Find is not archive/token search.
  for (const query of ['10.02.26', 'Friday', 'elsewhere-only', 'lamp post']) {
    await findInput(page).fill(query);
    await expect(page.getByText('No matches', { exact: true })).toBeVisible();
    await expect(marks(page)).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: 'Previous match' }),
    ).toBeDisabled();
    await expect(
      page.getByRole('button', { name: 'Next match' }),
    ).toBeDisabled();
  }
});

test('a phrase spanning inline Markdown is one match without losing formatting', async ({
  page,
}) => {
  await openFind(page, 'a formatted phrase');
  await expect(page.getByText('1 of 1', { exact: true })).toBeVisible();
  await expect
    .poll(() =>
      marks(page).evaluateAll((elements) =>
        elements.map((element) => element.textContent).join(''),
      ),
    )
    .toBe('A formatted phrase');
  expect(
    await marks(page).evaluateAll(
      (elements) =>
        new Set(
          elements.map((element) => element.getAttribute('data-entry-match')),
        ).size,
    ),
  ).toBe(1);
  await expect(page.locator('.prose strong')).toHaveText('formatted');
  await expect(page.locator('.prose em')).toHaveText('phrase');
  await expect(
    page.getByRole('link', { name: 'ordinary link' }),
  ).toHaveAttribute('href', 'https://example.com');
  expect(await activeMarks(page).count()).toBe(await marks(page).count());

  await page.getByRole('button', { name: 'Close find' }).click();
  await expect(marks(page)).toHaveCount(0);
  await expect(page.locator('.prose strong')).toHaveText('formatted');
  await expect(page.locator('.prose em')).toHaveText('phrase');
});

test('Cmd+F and Ctrl+F open find and repeated shortcuts refocus and select the query', async ({
  page,
}) => {
  for (const shortcut of ['Meta+f', 'Control+f']) {
    await page.keyboard.press(shortcut);
    await expect(findInput(page)).toBeFocused();
    await findInput(page).fill('lighthouse');
    await expectMatchPosition(page, 1, 3);
    await page.getByRole('button', { name: 'Next match' }).click();
    await expectMatchPosition(page, 2, 3);
    await page.keyboard.press(shortcut);
    await expect(findInput(page)).toBeFocused();
    await expect(findInput(page)).toHaveCount(1);
    expect(
      await findInput(page).evaluate((element: HTMLInputElement) => [
        element.selectionStart,
        element.selectionEnd,
      ]),
    ).toEqual([0, 'lighthouse'.length]);
    await expectMatchPosition(page, 2, 3);
    await page.getByRole('button', { name: 'Close find' }).click();
  }
});

test('match buttons and Enter shortcuts wrap in both directions', async ({
  page,
}) => {
  await openFind(page, 'lighthouse');
  await expectMatchPosition(page, 1, 3);
  await page.getByRole('button', { name: 'Previous match' }).click();
  await expectMatchPosition(page, 3, 3);
  await page.getByRole('button', { name: 'Next match' }).click();
  await expectMatchPosition(page, 1, 3);
  await findInput(page).press('Shift+Enter');
  await expectMatchPosition(page, 3, 3);
  await findInput(page).press('Enter');
  await expectMatchPosition(page, 1, 3);
  await findInput(page).press('Enter');
  await expectMatchPosition(page, 2, 3);
  await findInput(page).press('Shift+Enter');
  await expectMatchPosition(page, 1, 3);
});

test('changing or clearing the query resets results and closing removes every highlight', async ({
  page,
}) => {
  await openFind(page, 'lighthouse');
  await findInput(page).press('Shift+Enter');
  await expectMatchPosition(page, 3, 3);
  await findInput(page).fill('[a-z]+.*?');
  await expectMatchPosition(page, 1, 2);
  await findInput(page).fill('');
  await expect(marks(page)).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Previous match' }),
  ).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Next match' })).toBeDisabled();
  await findInput(page).press('Enter');
  await expect(findInput(page)).toBeVisible();
  await findInput(page).fill('lighthouse');
  await expectMatchPosition(page, 1, 3);
  await page.getByRole('button', { name: 'Close find' }).click();
  await expect(findInput(page)).toHaveCount(0);
  await expect(page.locator('mark[data-entry-match]')).toHaveCount(0);
  await expect(page.locator('.prose')).toContainText(
    'Lighthouse lighthouse LIGHTHOUSE.',
  );
});

test('original-text mode searches the complete source and recomputes on toggling', async ({
  page,
}) => {
  await openFind(page, 'Friday');
  await expect(page.getByText('No matches', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Show original text' }).click();
  await expectMatchPosition(page, 1, 1);
  await expect(page.locator('.raw-text mark')).toHaveText('FRIDAY');
  await findInput(page).fill('**formatted**');
  await expectMatchPosition(page, 1, 1);
  await expect(page.locator('.raw-text mark')).toHaveText('**formatted**');
  await page.getByRole('button', { name: 'Show rendered entry' }).click();
  await expect(findInput(page)).toHaveValue('**formatted**');
  await expect(page.getByText('No matches', { exact: true })).toBeVisible();
  await expect(marks(page)).toHaveCount(0);
  await findInput(page).fill('a formatted phrase');
  await expect(page.getByText('1 of 1', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Show original text' }).click();
  await expect(page.getByText('No matches', { exact: true })).toBeVisible();
  await expect(marks(page)).toHaveCount(0);
});

test('entry navigation retains the open query and restarts at the first match', async ({
  page,
}) => {
  await openFind(page, 'lighthouse');
  await findInput(page).press('Shift+Enter');
  await expectMatchPosition(page, 3, 3);
  await page
    .getByRole('button', { name: 'Previous entry', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'October 1', exact: true }),
  ).toBeVisible();
  await expect(findInput(page)).toHaveValue('lighthouse');
  await expectMatchPosition(page, 1, 2);
  await findInput(page).press('Enter');
  await expectMatchPosition(page, 2, 2);
  // Option+Arrow remains text navigation while an input is focused.
  await page.getByRole('button', { name: 'Next match' }).focus();
  await page.keyboard.press('Alt+ArrowRight');
  await expect(
    page.getByRole('heading', { name: 'October 2', exact: true }),
  ).toBeVisible();
  await expect(findInput(page)).toHaveValue('lighthouse');
  await expectMatchPosition(page, 1, 3);
});

test('active matches scroll into view, including a new entry with a distant first match', async ({
  page,
}) => {
  const filler = Array.from(
    { length: 70 },
    (_, index) =>
      `Fictional paragraph ${index + 1}. A quiet afternoon left plenty of time to read, write, and watch the changing sky.`,
  ).join('\n\n');
  await page.evaluate(async (filler) => {
    await window.journalTest.update(
      '10.02.26.txt',
      `FRIDAY\n8/10\n===============\nLighthouse at the opening.\n\n${filler}\n\nLighthouse at the closing.`,
    );
    await window.journalTest.update(
      '10.01.26.txt',
      `THURSDAY\n7/10\n===============\n${filler}\n\nLighthouse waits far below in the previous entry.`,
    );
  }, filler);
  await expect(page.locator('.prose')).toContainText(
    'Lighthouse at the closing.',
  );
  await openFind(page, 'lighthouse');
  await expectMatchPosition(page, 1, 2);
  await page.getByRole('button', { name: 'Next match' }).click();
  await expectMatchPosition(page, 2, 2);
  const activeMatchIsInReader = () =>
    activeMarks(page).evaluate((element) => {
      const match = element.getBoundingClientRect();
      const reader = document
        .querySelector('.reader-scroll')!
        .getBoundingClientRect();
      return match.top >= reader.top && match.bottom <= reader.bottom;
    });
  await expect.poll(activeMatchIsInReader).toBe(true);
  expect(
    await page
      .locator('.reader-scroll')
      .evaluate((element) => element.scrollTop),
  ).toBeGreaterThan(200);

  await page
    .getByRole('button', { name: 'Previous entry', exact: true })
    .click();
  await expect(page.locator('.source-file')).toContainText('10.01.26.txt');
  await expectMatchPosition(page, 1, 1);
  await expect.poll(activeMatchIsInReader).toBe(true);
  expect(
    await page
      .locator('.reader-scroll')
      .evaluate((element) => element.scrollTop),
  ).toBeGreaterThan(200);
  await page.screenshot({
    path: 'test-results/entry-find-long.png',
    animations: 'disabled',
    fullPage: true,
  });
});

test('opening the calendar dismisses find and its highlights', async ({
  page,
}) => {
  await openFind(page, 'lighthouse');
  await expectMatchPosition(page, 1, 3);
  await page.getByRole('button', { name: 'Calendar', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'A life in days.' }),
  ).toBeVisible();
  await expect(findInput(page)).toHaveCount(0);
  await expect(page.locator('mark[data-entry-match]')).toHaveCount(0);
  await page.keyboard.press('Meta+f');
  await expect(findInput(page)).toHaveCount(0);
  await page
    .getByRole('button', { name: 'October 2, 2026, 1 entries', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'October 2', exact: true }),
  ).toBeVisible();
  await expect(findInput(page)).toHaveCount(0);
});

test('Escape closes find before leaving focus mode', async ({ page }) => {
  await page.getByRole('button', { name: 'Focus mode', exact: true }).click();
  await openFind(page, 'lighthouse');
  await expectMatchPosition(page, 1, 3);
  await page.keyboard.press('Escape');
  await expect(findInput(page)).toHaveCount(0);
  await expect(marks(page)).toHaveCount(0);
  await expect(page.locator('.sidebar')).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(page.locator('.sidebar')).toBeVisible();
});

test('command palette keeps keyboard priority and archive search still works', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Focus mode', exact: true }).click();
  await openFind(page, 'lighthouse');
  await page.keyboard.press('Meta+k');
  const search = page.getByRole('textbox', {
    name: 'Search entries and commands',
  });
  await expect(search).toBeFocused();
  await page.keyboard.press('Meta+f');
  await expect(search).toBeFocused();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(findInput(page)).toBeVisible();
  await expect(page.locator('.sidebar')).toBeHidden();

  await page.keyboard.press('Control+k');
  await search.fill('elsewhere-only');
  await expect(page.getByRole('dialog').getByRole('option')).toHaveCount(1);
  await search.press('Enter');
  await expect(page.locator('.source-file')).toContainText('10.01.26.txt');
  await expect(page.locator('.prose')).toContainText('Lighthouse begins here.');
  await expect(findInput(page)).toHaveValue('lighthouse');
  await expectMatchPosition(page, 1, 2);
});

test('the rebuild dialog handles Escape without closing find behind it', async ({
  page,
}) => {
  await openFind(page, 'lighthouse');
  await page.getByRole('button', { name: 'Rebuild app', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Control+f');
  await expect(findInput(page)).not.toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(findInput(page)).toBeVisible();
  await expectMatchPosition(page, 1, 3);
});

test('live edits update the current match count without stale highlights or runtime errors', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openFind(page, 'lighthouse');
  await findInput(page).press('Shift+Enter');
  await expectMatchPosition(page, 3, 3);
  await page.evaluate(() =>
    window.journalTest.update(
      '10.02.26.txt',
      'FRIDAY\n8/10\n===============\nUpdated lighthouse remains.\n\nA replacement paragraph.',
    ),
  );
  await expect(page.locator('.prose')).toContainText(
    'Updated lighthouse remains.',
  );
  await expect(findInput(page)).toHaveValue('lighthouse');
  await expectMatchPosition(page, 1, 1);
  await page.evaluate(() =>
    window.journalTest.update(
      '10.02.26.txt',
      'FRIDAY\n8/10\n===============\nThe final revision has no matching word.',
    ),
  );
  await expect(page.locator('.prose')).toContainText('The final revision');
  await expect(page.getByText('No matches', { exact: true })).toBeVisible();
  await expect(marks(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Close find' }).click();
  await expect(errors).toEqual([]);
});
