import { Marked } from 'marked';

/*
 * Markdown as plain HTML, for documents the app makes (a chat as a PDF). Raw HTML in the text is
 * shown as text, never run; maths stays as written.
 */

const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const markdown = new Marked({ gfm: true, breaks: true });
markdown.use({
  renderer: {
    html: (token) => escape(token.text),
  },
  walkTokens: (token) => {
    // Links and images keep only http(s) and data: addresses.
    if ((token.type === 'link' || token.type === 'image') && !/^(https?:|data:image\/)/i.test(token.href)) token.href = '';
  },
});

export function markdownToHtml(source: string): string {
  return markdown.parse(source, { async: false });
}

export { escape as escapeHtml };
