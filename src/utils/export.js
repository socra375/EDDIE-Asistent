// Client-side export helpers. TXT and CSV are native Blob downloads.
// PDF uses the browser's print-to-PDF dialog (no extra dependency needed).
// DOC uses an HTML-in-.doc trick that Word/LibreOffice open natively.

function download(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function exportTxt(filename, content) {
  download(filename.endsWith('.txt') ? filename : `${filename}.txt`, content, 'text/plain;charset=utf-8');
}

export function exportCsv(filename, content) {
  const rows = content
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => `"${line.replace(/"/g, '""')}"`);
  download(filename.endsWith('.csv') ? filename : `${filename}.csv`, rows.join('\n'), 'text/csv;charset=utf-8');
}

function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function toHtmlDocument(title, content) {
  const body = escapeHtml(content)
    .split('\n')
    .map((line) => `<p>${line || '&nbsp;'}</p>`)
    .join('\n');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
  <style>
    body { font-family: 'Segoe UI', Arial, sans-serif; color: #1a1a1a; line-height: 1.5; padding: 2rem; }
    h1 { font-size: 1.4rem; }
    p { margin: 0 0 0.6rem; white-space: pre-wrap; }
  </style></head><body><h1>${escapeHtml(title)}</h1>${body}</body></html>`;
}

export function exportDoc(filename, title, content) {
  const html = toHtmlDocument(title, content);
  download(filename.endsWith('.doc') ? filename : `${filename}.doc`, html, 'application/msword;charset=utf-8');
}

export function exportPdf(title, content) {
  const html = toHtmlDocument(title, content);
  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    throw new Error('El navegador bloqueó la ventana de impresión. Permite ventanas emergentes para exportar a PDF.');
  }
  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.focus();
  printWindow.onload = () => printWindow.print();
}
