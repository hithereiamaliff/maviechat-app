import { Marked, type Tokens } from 'marked';
import { escapeHtml } from './html';

/*
 * A note's Markdown as the HTML Open WebUI's note editor loads (0.11.3): line breaks kept (a single
 * new line is a line break), GitHub tables and strikethrough, and checklists as the editor's own
 * task lists (`<ul data-type="taskList">` with `<li data-type="taskItem" data-checked="…">`), the
 * shape the web makes from Markdown itself. Raw HTML is shown as text, except underline and line
 * breaks, which the web writes into a note's Markdown; links keep only web and mail addresses, and
 * the server's own file links: a picture as `![name](/api/v1/files/…/content)`, and an attached
 * file as a link of its own on a line, which 0.12's editor shows as an attachment
 * (`<div data-file-id>`, its shape for one).
 */

const KEPT_HTML = /^(<\/?u>|<br\s*\/?>)$/i;
const FILE_LINK = /^\/api\/v1\/files\/([\w-]+)\/content$/;

/** A paragraph that holds only file links (one a line): the file ids and names, else null. */
function attachmentsOnly(tokens: Tokens.Generic[]): { id: string; name: string }[] | null {
  const files: { id: string; name: string }[] = [];
  for (const token of tokens) {
    if (token.type === 'br' || (token.type === 'text' && !token.raw.trim())) continue;
    const id = token.type === 'link' ? FILE_LINK.exec(String(token.href))?.[1] : undefined;
    if (!id) return null;
    files.push({ id, name: String(token.text) });
  }
  return files.length ? files : null;
}

const notes = new Marked({ gfm: true, breaks: true });
notes.use({
  renderer: {
    html({ text }: Tokens.HTML | Tokens.Tag) {
      return KEPT_HTML.test(text.trim()) ? text : escapeHtml(text);
    },
    list(token: Tokens.List) {
      if (!token.items.some((item) => item.task)) return false;
      return `<ul data-type="taskList">${token.items.map((item) => this.listitem(item)).join('')}</ul>\n`;
    },
    listitem(item: Tokens.ListItem) {
      if (!item.task) return false;
      return `<li data-type="taskItem" data-checked="${item.checked ? 'true' : 'false'}">${this.parser.parse(item.tokens)}</li>\n`;
    },
    // The task item says whether it's ticked; no form box.
    checkbox() {
      return '';
    },
    paragraph(token: Tokens.Paragraph) {
      const files = attachmentsOnly(token.tokens);
      if (!files) return false;
      return files.map((file) => `<div data-file-id="${escapeHtml(file.id)}" data-file-size="0"><a href="/api/v1/files/${escapeHtml(file.id)}/content">${escapeHtml(file.name)}</a></div>\n`).join('');
    },
  },
  walkTokens(token) {
    if ((token.type === 'link' || token.type === 'image') && !/^(https?:|mailto:|data:image\/)/i.test(token.href) && !FILE_LINK.test(token.href)) token.href = '';
  },
});

/** The HTML to save beside a note's Markdown, so the web shows what was written on the phone. */
export function noteHtml(markdown: string): string {
  return notes.parse(markdown, { async: false });
}
