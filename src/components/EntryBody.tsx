import { useMemo } from 'react';
import { Compass, HeartHandshake, Sparkles, Sun } from 'lucide-react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { openUrl } from '@tauri-apps/plugin-opener';
import { desktop } from '../lib/archive';
import { readingBlocks } from '../lib/reflection';
import './Reflection.css';

const icons = {
  Gratitude: Sun,
  Forgiveness: HeartHandshake,
  Curiosity: Compass,
};
export function EntryBody({
  body,
  onError,
}: {
  body: string;
  onError: (message: string) => void;
}) {
  const blocks = useMemo(() => readingBlocks(body), [body]);
  const components: Components = {
    img: ({ alt }) => (
      <span className="image-placeholder">[Image: {alt || 'attachment'}]</span>
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
  };
  const markdown = (text: string) => (
    <Markdown remarkPlugins={[remarkGfm]} components={components}>
      {text}
    </Markdown>
  );
  return blocks.map((block, index) =>
    block.type === 'markdown' ? (
      <div className="markdown-block" key={index}>
        {markdown(block.text || '*This entry is empty.*')}
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
            <h2>The 3 and 3</h2>
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
            {markdown(block.introduction)}
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
                  <h3>{section.name}</h3>
                </div>
                <ol>
                  {section.items.map((item, i) => (
                    <li key={i} value={item.number}>
                      <span className="reflection-number" aria-hidden="true">
                        {String(item.number).padStart(2, '0')}
                      </span>
                      <div>{markdown(item.text)}</div>
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
