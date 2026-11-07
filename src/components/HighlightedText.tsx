import { Fragment, useId } from 'react';
import { findTextMatches } from '../lib/entry-search';

export function HighlightedText({
  text,
  query,
}: {
  text: string;
  query: string;
}) {
  const prefix = useId();
  const matches = findTextMatches(text, query);
  let cursor = 0;
  return (
    <>
      {matches.map((match, index) => {
        const before = text.slice(cursor, match.start);
        cursor = match.end;
        return (
          <Fragment key={index}>
            {before}
            <mark data-entry-match={`${prefix}-${index}`}>
              {text.slice(match.start, match.end)}
            </mark>
          </Fragment>
        );
      })}
      {text.slice(cursor)}
    </>
  );
}
