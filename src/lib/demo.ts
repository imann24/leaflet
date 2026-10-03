import type { Archive, SourceEntry } from './journal';
// Fictional fixtures only. Never bundle personal journal text into the application.
const entries: SourceEntry[] = [];
const reflectionDemo = `===============
3 x Gratitude
3 x Forgiveness
3 x Curiosity

the 3 and 3
===============

GRATITUDE
1. A slow morning and a really good cup of coffee.
2. A friend who made time for a long conversation.
3. The little patch of sunlight on the kitchen floor.

FORGIVENESS
1. I forgive myself for leaving a few things unfinished.
2. I forgive myself for needing more rest than I planned.
3. I forgive myself for not having all the answers yet.

CURIOSITY
1. What will I notice if I take a different route tomorrow?
2. How will the seeds on the windowsill change this week?
3. What might happen if I give that small idea a chance?

===============

`;

for (const [year, month, days] of [
  [2024, 10, [2, 3, 8, 12, 18, 24]],
  [2025, 10, [1, 3, 7, 11, 16, 22, 30]],
  [2026, 9, [2, 4, 8, 13, 16, 21, 24, 27, 30]],
  [2026, 10, [1, 2]],
] as const) {
  for (const day of days) {
    const name = `${month}.${String(day).padStart(2, '0')}.${String(year).slice(2)}.txt`;
    const date = new Date(year, month - 1, day);
    const body =
      day % 2 === 0
        ? 'A little room to breathe.\n\nI took the long way home today. The air had that particular feeling of a season beginning to change, and for once I wasn’t in a hurry to get anywhere.\n\nThere was a small café on the corner I’ve walked past a hundred times. Today I finally went in. A good coffee, an open window, an hour with a book. Nothing remarkable, which was exactly what I needed.\n\n## Things I want to remember\n\n- The light falling across the kitchen floor.\n- A conversation that lasted longer than either of us planned.\n- How much better a walk can make an ordinary afternoon.\n\n> Pay attention. There is a lot here.\n\nI’m learning that a good day doesn’t always need a big story. Sometimes it’s enough to have been present for the small ones.'
        : 'Today felt like a fresh page.\n\nSpent the morning making a little progress on something I care about. It was slow, satisfying work. I left my phone in the other room and remembered what it feels like to do one thing at a time.\n\nLater, a walk through the neighborhood and dinner with a friend. We talked about the things we used to worry about, and how differently they look from here.\n\n**A thought to keep:** there’s no need to have everything figured out before taking the next step.';
    entries.push({
      path: `${year}-${String(month).padStart(2, '0')}-Demo/${name}`,
      name,
      month: `${year}-${String(month).padStart(2, '0')}`,
      content: `${date.toLocaleDateString('en-US', { weekday: 'long' }).toUpperCase()}\n${7 + (day % 5) * 0.5}/10\n===============\n${year === 2026 && month === 10 && day === 1 ? reflectionDemo : ''}${year === 2026 && month === 9 && day === 30 ? '===============\n3x3 >>> SKIPPED\n===============\n\n' : ''}${body}`,
    });
  }
}
export const demo: Archive = {
  root: 'Demo journal · fictional entries',
  entries,
  warnings: [],
};
