import { parseBlocks, parseInline } from './markdown';

// Renders an answer: ```code``` blocks in monospace, and simple Markdown
// (headings, lists, quotes, **bold**, *italic*, `code`, links) as real
// elements. Built from plain data (see markdown.js), never from HTML strings.
const FENCE_RE = /```(\w*)\n?([\s\S]*?)```/g;

function splitFences(text) {
  const blocks = [];
  let lastIndex = 0;
  let match;
  FENCE_RE.lastIndex = 0;
  while ((match = FENCE_RE.exec(text)) !== null) {
    if (match.index > lastIndex) blocks.push({ type: 'text', content: text.slice(lastIndex, match.index) });
    blocks.push({ type: 'code', lang: match[1], content: match[2] });
    lastIndex = FENCE_RE.lastIndex;
  }
  if (lastIndex < text.length) blocks.push({ type: 'text', content: text.slice(lastIndex) });
  return blocks;
}

function Inline({ text }) {
  return parseInline(text).map((piece, i) => {
    if (piece.type === 'strong') return <strong key={i}>{piece.text}</strong>;
    if (piece.type === 'em') return <em key={i}>{piece.text}</em>;
    if (piece.type === 'code') return <code key={i} className="rich-text__code">{piece.text}</code>;
    if (piece.type === 'link') {
      return (
        <a key={i} href={piece.href} target="_blank" rel="noopener noreferrer">
          {piece.text}
        </a>
      );
    }
    return piece.text;
  });
}

function Block({ block }) {
  if (block.type === 'h') {
    return (
      <p className={`rich-text__heading rich-text__heading--${block.level}`}>
        <Inline text={block.text} />
      </p>
    );
  }
  if (block.type === 'ul' || block.type === 'ol') {
    const List = block.type;
    return (
      <List className="rich-text__list">
        {block.items.map((item, i) => (
          <li key={i}>
            <Inline text={item} />
          </li>
        ))}
      </List>
    );
  }
  if (block.type === 'quote') {
    return (
      <blockquote className="rich-text__quote">
        <Inline text={block.text} />
      </blockquote>
    );
  }
  return (
    <p className="rich-text__paragraph">
      <Inline text={block.text} />
    </p>
  );
}

export default function RichText({ text }) {
  if (!text) return null;
  return (
    <>
      {splitFences(text).map((part, i) =>
        part.type === 'code' ? (
          <pre className="code-block" key={i}>
            {part.lang && <span className="code-block__lang">{part.lang}</span>}
            <code>{part.content.trim()}</code>
          </pre>
        ) : (
          parseBlocks(part.content).map((block, j) => <Block key={`${i}-${j}`} block={block} />)
        ),
      )}
    </>
  );
}
