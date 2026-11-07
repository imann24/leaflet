import { useId, useMemo } from 'react';
import { Compass, HeartHandshake, Sparkles, Sun } from 'lucide-react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { openUrl } from '@tauri-apps/plugin-opener';
import { desktop } from '../lib/archive';
import { readingBlocks } from '../lib/reflection';
import { highlightEntryText } from '../lib/entry-search';
import { HighlightedText } from './HighlightedText';
import './Reflection.css';

const icons = {
  Gratitude: Sun,
  Forgiveness: HeartHandshake,
  Curiosity: Compass,
};
export function EntryBody({
  body,
  onError,
  query = '',
}: {
  body: string;
  onError: (message: string) => void;
  query?: string;
}) {
  const prefix = useId();
  const blocks = useMemo(() => readingBlocks(body), [body]);
  const components = useMemo<Components>(
    () => ({
      img: ({ alt }) => (
        <span className="image-placeholder">
          [Image:{' '}
          {alt ? <HighlightedText text={alt} query={query} /> : 'attachment'}]
        </span>
      ),
      a: ({ href, children }) => (
        <a
          href={href}
          onClick={(event) => {
            event.preventDefault();
            if (href && /^(https?:|mailto:)/.test(href)) {
              if (desktop)
                void openUrl(href).catch((error) => onError(String(error)));
              else window.open(href, '_blank', 'noopener,noreferrer');
            }
          }}
        >
          {children}
        </a>
      ),
    }),
    [onError, query],
  );
  const markdown = (text: string, id: string) => (
    <Markdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[highlightEntryText(query, `${prefix}-${id}`)]}
      components={components}
    >
      {text}
    </Markdown>
  );
  return blocks.map((block, index) =>
    block.type === 'markdown' ? (
      <div className="markdown-block" key={index}>
        {block.text ? (
          markdown(block.text, `${index}`)
        ) : (
          <p>
            <em>This entry is empty.</em>
          </p>
        )}
      </div>
    ) : block.type === 'omitted' ? null : (
      <section
        className="reflection"
        aria-label="The 3 and 3 reflection"
        key={index}
      >
        <header className="reflection-heading">
          <div className="reflection-eyebrow">
            <Sparkles size={14} aria-hidden="true" />
            DAILY PRACTICE
          </div>
          <div className="reflection-title-row">
            <h2>
              <HighlightedText text="The 3 and 3" query={query} />
            </h2>
            <span>
              {block.sections.reduce(
                (count, section) => count + section.items.length,
                0,
              )}{' '}
              reflections
            </span>
          </div>
        </header>
        {block.introduction && (
          <div className="reflection-introduction">
            {markdown(block.introduction, `${index}-introduction`)}
          </div>
        )}
        <div className="reflection-sections">
          {block.sections.map((section) => {
            const Icon = icons[section.name];
            return (
              <section
                className={`reflection-card reflection-${section.name.toLowerCase()}`}
                aria-label={section.name}
                key={section.name}
              >
                <div className="reflection-card-heading">
                  <span className="reflection-icon">
                    <Icon size={18} aria-hidden="true" />
                  </span>
                  <h3>
                    <HighlightedText text={section.name} query={query} />
                  </h3>
                </div>
                <ol>
                  {section.items.map((item, i) => (
                    <li key={i} value={item.number}>
                      <span className="reflection-number" aria-hidden="true">
                        {String(item.number).padStart(2, '0')}
                      </span>
                      <div>
                        {markdown(item.text, `${index}-${section.name}-${i}`)}
                      </div>
                    </li>
                  ))}
                </ol>
              </section>
            );
          })}
        </div>
      </section>
    ),
  );
}
