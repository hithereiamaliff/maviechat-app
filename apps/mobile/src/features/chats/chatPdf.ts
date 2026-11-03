import { escapeHtml, markdownToHtml } from '@maviechat/owui-markdown';
import { branchPath, outputText, type ChatRecord } from '@maviechat/owui-protocol';

/**
 * A chat as a printable page, for its PDF download: the title and date, then each message of the
 * shown branch under who wrote it, as formatted text. Reasoning and tool details are left out, as
 * in the text download; maths stays as written.
 */
export function chatPdfHtml(chat: Pick<ChatRecord, 'title' | 'chat' | 'updated_at'>, modelName: (id: string | undefined) => string): string {
  const history = chat.chat?.history;
  const messages = history ? branchPath(history).filter((message) => message.role === 'user' || message.role === 'assistant') : [];
  const date = chat.updated_at ? new Date(chat.updated_at * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
  const body = messages
    .map((message) => {
      const text = (outputText(message.output) || message.content || '').replace(/<details[^>]*>[\s\S]*?<\/details>/gi, '').trim();
      if (!text) return '';
      const who = message.role === 'user' ? 'You' : modelName(message.model);
      return `<section class="${message.role}"><h2>${escapeHtml(who)}</h2>${markdownToHtml(text)}</section>`;
    })
    .filter(Boolean)
    .join('\n');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
body{font-family:-apple-system,system-ui,sans-serif;font-size:11pt;line-height:1.5;color:#171717}
h1{font-size:18pt;margin:0 0 2pt}
.date{color:#737373;margin:0 0 14pt}
section{margin:0 0 12pt;page-break-inside:auto}
section h2{font-size:10pt;text-transform:uppercase;letter-spacing:.04em;color:#525252;margin:0 0 4pt}
section.user{background:#f5f5f5;border-radius:6pt;padding:6pt 9pt}
pre{background:#f5f5f5;border-radius:4pt;padding:6pt;white-space:pre-wrap;word-break:break-word;font-size:9pt}
code{font-family:Menlo,monospace;font-size:9pt}
table{border-collapse:collapse;margin:4pt 0}th,td{border:1px solid #d4d4d4;padding:3pt 6pt;text-align:left}
img{max-width:100%}blockquote{border-left:3pt solid #d4d4d4;margin:0;padding-left:8pt;color:#404040}
</style></head><body><h1>${escapeHtml(chat.title || 'Chat')}</h1>${date ? `<p class="date">${escapeHtml(date)}</p>` : ''}${body}</body></html>`;
}
