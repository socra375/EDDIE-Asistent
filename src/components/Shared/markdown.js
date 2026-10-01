// A small, safe Markdown reader for chat answers (the local probe answers in
// Markdown; documents too). It never produces HTML strings: it returns plain
// data that RichText turns into React elements, so nothing in an answer can
// inject markup. Supported: # headings, - / * / + lists, 1. lists, > quotes,
// paragraphs, and inline **bold**, *italic*, `code` and [links](https://…).

// Inline pieces → [{ type: 'text'|'strong'|'em'|'code'|'link', text, href? }].
const INLINE_RE = /(\*\*[^*\n]+?\*\*|__[^_\n]+?__|`[^`\n]+`|\[[^\]\n]+\]\((?:https?:\/\/)[^\s)]+\)|(?<![\w*])\*[^*\n\s][^*\n]*?\*(?![\w*])|(?<![\w])_[^_\n\s][^_\n]*?_(?![\w]))/g;

export function parseInline(text) {
  const out = [];
  let last = 0;
  for (const m of String(text).matchAll(INLINE_RE)) {
    if (m.index > last) out.push({ type: 'text', text: text.slice(last, m.index) });
    const t = m[0];
    if (t.startsWith('**') || t.startsWith('__')) out.push({ type: 'strong', text: t.slice(2, -2) });
    else if (t.startsWith('`')) out.push({ type: 'code', text: t.slice(1, -1) });
    else if (t.startsWith('[')) {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(t);
      out.push({ type: 'link', text: link[1], href: link[2] });
    } else out.push({ type: 'em', text: t.slice(1, -1) });
    last = m.index + t.length;
  }
  if (last < text.length) out.push({ type: 'text', text: text.slice(last) });
  return out;
}

// A text block (no code fences) → [{ type: 'p'|'h'|'ul'|'ol'|'quote', text?, level?, items? }].
export function parseBlocks(text) {
  const blocks = [];
  let para = [];
  let list = null;
  const flushPara = () => {
    if (para.length) blocks.push({ type: 'p', text: para.join('\n') });
    para = [];
  };
  const flushList = () => {
    if (list) blocks.push(list);
    list = null;
  };
  for (const raw of String(text).split('\n')) {
    const line = raw.replace(/\s+$/, '');
    let m;
    if (!line.trim()) {
      flushPara();
      flushList();
    } else if ((m = /^\s{0,3}(#{1,6})\s+(.*)$/.exec(line))) {
      flushPara();
      flushList();
      blocks.push({ type: 'h', level: Math.min(m[1].length, 3), text: m[2].replace(/\s+#+$/, '') });
    } else if ((m = /^\s*[-*+•]\s+(.*)$/.exec(line))) {
      flushPara();
      if (list?.type !== 'ul') flushList();
      list = list || { type: 'ul', items: [] };
      list.items.push(m[1]);
    } else if ((m = /^\s*\d+[.)]\s+(.*)$/.exec(line))) {
      flushPara();
      if (list?.type !== 'ol') flushList();
      list = list || { type: 'ol', items: [] };
      list.items.push(m[1]);
    } else if ((m = /^\s*>\s?(.*)$/.exec(line))) {
      flushPara();
      flushList();
      const prev = blocks[blocks.length - 1];
      if (prev?.type === 'quote') prev.text += `\n${m[1]}`;
      else blocks.push({ type: 'quote', text: m[1] });
    } else if (list && /^\s{2,}\S/.test(raw)) {
      // An indented continuation of the last list item.
      list.items[list.items.length - 1] += ` ${line.trim()}`;
    } else {
      flushList();
      para.push(line.trim());
    }
  }
  flushPara();
  flushList();
  return blocks;
}
