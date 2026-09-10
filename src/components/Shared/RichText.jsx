// Minimal fenced-code-block renderer so AI answers containing ```code```
// show up in monospace blocks instead of raw text with stray backticks.
const FENCE_RE = /```(\w*)\n?([\s\S]*?)```/g;

function splitBlocks(text) {
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

// Splits a text block on blank lines so each real paragraph becomes its
// own <p> — otherwise a whole multi-paragraph block renders as a single
// element and the CSS margin between paragraphs never applies, making the
// text look like one pasted-together block.
function splitParagraphs(text) {
  return text
    .split(/\n\s*\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
}

export default function RichText({ text }) {
  if (!text) return null;
  const blocks = splitBlocks(text);

  return (
    <>
      {blocks.map((block, i) =>
        block.type === 'code' ? (
          <pre className="code-block" key={i}>
            {block.lang && <span className="code-block__lang">{block.lang}</span>}
            <code>{block.content.trim()}</code>
          </pre>
        ) : (
          splitParagraphs(block.content).map((paragraph, j) => (
            <p className="rich-text__paragraph" key={`${i}-${j}`}>
              {paragraph}
            </p>
          ))
        ),
      )}
    </>
  );
}
