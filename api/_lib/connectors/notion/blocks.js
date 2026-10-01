// Notion pages are made of blocks. These two functions turn them into plain
// text Eddie can read (blocksToText) and turn the Markdown-ish text Eddie
// writes into blocks (markdownToBlocks).
const MAX_RICH_TEXT = 2000; // Notion's limit per text segment
export const MAX_BLOCKS = 100; // Notion's limit per request

const plain = (rich) => (Array.isArray(rich) ? rich.map((t) => t.plain_text ?? t.text?.content ?? '').join('') : '');

// One block as a line of text (without its children).
export function blockLine(block) {
  const data = block[block.type] || {};
  const text = plain(data.rich_text);
  switch (block.type) {
    case 'heading_1':
      return `# ${text}`;
    case 'heading_2':
      return `## ${text}`;
    case 'heading_3':
      return `### ${text}`;
    case 'bulleted_list_item':
      return `- ${text}`;
    case 'numbered_list_item':
      return `1. ${text}`;
    case 'to_do':
      return `- [${data.checked ? 'x' : ' '}] ${text}`;
    case 'toggle':
      return `▸ ${text}`;
    case 'quote':
      return `> ${text}`;
    case 'callout':
      return `💡 ${text}`;
    case 'code':
      return `\`\`\`${data.language && data.language !== 'plain text' ? data.language : ''}\n${text}\n\`\`\``;
    case 'divider':
      return '---';
    case 'child_page':
      return `[Subpágina: ${data.title || 'sin título'}]`;
    case 'child_database':
      return `[Base de datos: ${data.title || 'sin título'}]`;
    case 'bookmark':
    case 'link_preview':
    case 'embed':
      return data.url ? `[Enlace: ${data.url}]` : '';
    case 'image':
    case 'file':
    case 'pdf':
    case 'video':
      return `[${block.type === 'image' ? 'Imagen' : 'Archivo'}${plain(data.caption) ? `: ${plain(data.caption)}` : ''}]`;
    case 'table_row':
      return (data.cells || []).map((c) => plain(c)).join(' | ');
    case 'equation':
      return data.expression || '';
    default:
      return text;
  }
}

// `nodes` = [{ block, children: [...] }] as the connector reads them.
export function blocksToText(nodes, depth = 0) {
  const lines = [];
  for (const { block, children } of nodes) {
    const line = blockLine(block);
    const indent = '  '.repeat(depth);
    if (line !== '') lines.push(...line.split('\n').map((l) => `${indent}${l}`));
    if (children?.length) lines.push(blocksToText(children, depth + 1));
  }
  return lines.filter((l) => l !== '').join('\n');
}

function richText(text) {
  const out = [];
  for (let i = 0; i < text.length; i += MAX_RICH_TEXT) out.push({ type: 'text', text: { content: text.slice(i, i + MAX_RICH_TEXT) } });
  return out.length ? out : [{ type: 'text', text: { content: '' } }];
}

const block = (type, text, extra = {}) => ({ object: 'block', type, [type]: { rich_text: richText(text), ...extra } });

// Markdown-ish text → Notion blocks: #, ##, ### headings, "- " / "* " bullets,
// "1. " numbered items, "- [ ]" / "- [x]" to-dos, "> " quotes, ``` code
// fences, "---" dividers, everything else paragraphs. At most MAX_BLOCKS;
// `truncated` says whether the text was longer.
export function markdownToBlocks(markdown) {
  const lines = String(markdown || '').replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const fence = /^```\s*([\w+-]*)\s*$/.exec(line.trim());
    if (fence) {
      const code = [];
      i += 1;
      while (i < lines.length && !/^```\s*$/.test(lines[i].trim())) {
        code.push(lines[i]);
        i += 1;
      }
      blocks.push(block('code', code.join('\n'), { language: fence[1] || 'plain text' }));
      i += 1;
      continue;
    }
    const t = line.trim();
    let m;
    if (!t) {
      // blank line: separates paragraphs, adds nothing
    } else if (/^(-{3,}|\*{3,})$/.test(t)) blocks.push({ object: 'block', type: 'divider', divider: {} });
    else if ((m = /^(#{1,3})\s+(.*)$/.exec(t))) blocks.push(block(`heading_${m[1].length}`, m[2]));
    else if ((m = /^[-*+]\s+\[( |x|X)\]\s+(.*)$/.exec(t))) blocks.push(block('to_do', m[2], { checked: m[1].toLowerCase() === 'x' }));
    else if ((m = /^[-*+]\s+(.*)$/.exec(t))) blocks.push(block('bulleted_list_item', m[1]));
    else if ((m = /^\d+[.)]\s+(.*)$/.exec(t))) blocks.push(block('numbered_list_item', m[1]));
    else if ((m = /^>\s?(.*)$/.exec(t))) blocks.push(block('quote', m[1]));
    else blocks.push(block('paragraph', t));
    i += 1;
  }
  return { blocks: blocks.slice(0, MAX_BLOCKS), truncated: blocks.length > MAX_BLOCKS };
}
