import { escapeHtml, markdownToHtml } from '@maviechat/owui-markdown';

/** A note as a printable page, for its PDF download: the title, then the text formatted. */
export function notePdfHtml(title: string, md: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
body{font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:11pt;line-height:1.45;color:#171717}
h1.title{font-size:20pt;margin:0 0 14pt}
pre{background:#f5f5f5;border-radius:4pt;padding:6pt;white-space:pre-wrap;word-break:break-word;font-size:9pt}
code{font-family:Menlo,monospace;font-size:9pt}
table{border-collapse:collapse;margin:4pt 0}th,td{border:1px solid #d4d4d4;padding:3pt 6pt;text-align:left}
img{max-width:100%}blockquote{border-left:3pt solid #d4d4d4;margin:0;padding-left:8pt;color:#404040}
li input{margin-right:4pt}
</style></head><body><h1 class="title">${escapeHtml(title)}</h1>${markdownToHtml(md)}</body></html>`;
}
