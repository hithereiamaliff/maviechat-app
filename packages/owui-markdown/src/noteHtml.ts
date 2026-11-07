import { Marked, type Tokens } from 'marked';
import { escapeHtml } from './html';

/*
 * A note's Markdown as the HTML Open WebUI's note editor loads (0.11.3): line breaks kept (a single
 * new line is a line break), GitHub tables and strikethrough, and checklists as the editor's own
 * task lists (`<ul data-type="taskList">` with `<li data-type="taskItem" data-checked="…">`), the
 * shape the web makes from Markdown itself. Raw HTML is shown as text, except underline and line
 * breaks, which the web writes into a note's Markdown; links keep only web and mail addresses.
 */

const KEPT_HTML = /^(<\/?u>|<br\s*\/?>)$/i;

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
  },
  walkTokens(token) {
    if ((token.type === 'link' || token.type === 'image') && !/^(https?:|mailto:|data:image\/)/i.test(token.href)) token.href = '';
  },
});

/** The HTML to save beside a note's Markdown, so the web shows what was written on the phone. */
export function noteHtml(markdown: string): string {
  return notes.parse(markdown, { async: false });
}
