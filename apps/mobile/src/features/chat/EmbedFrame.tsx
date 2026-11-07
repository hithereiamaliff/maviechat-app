import { embedAddress } from '@maviechat/owui-protocol';
import { createContext, useContext } from 'react';
import { useServerConfig } from '@/lib/server';
import { WebFrame } from '@/markdown/WebFrame';

/** What a tool's web content may ask of the chat, as on the web. */
export interface EmbedActions {
  /** `input:prompt`: the text goes into the message box. */
  setPrompt(text: string): void;
  /** `input:prompt:submit`: the text is sent, once you agree. */
  sendPrompt(text: string): void;
  /** `action:submit`: what's in the message box is sent, once you agree. */
  sendDraft(): void;
}

/** Given by an Open WebUI chat; without it, embeds can't reach the chat. */
export const EmbedActionsContext = createContext<EmbedActions | null>(null);

/** Passes on what an embed's page posted (untrusted: only these three, text capped). */
export function handleEmbedMessage(actions: EmbedActions | null, message: Record<string, unknown>): void {
  if (!actions) return;
  const text = typeof message.text === 'string' ? message.text.slice(0, 20_000) : '';
  if (message.type === 'input:prompt') actions.setPrompt(text);
  else if (message.type === 'input:prompt:submit' && text.trim()) actions.sendPrompt(text);
  else if (message.type === 'action:submit') actions.sendDraft();
}

/** The admin's Content-Security-Policy for embeds, first in the page so it wins, as the web adds it. */
export function withCsp(html: string, csp: string): string {
  if (!csp.trim()) return html;
  const tag = `<meta http-equiv="Content-Security-Policy" content="${csp.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}">`;
  const head = /<head(\s[^>]*)?>/i.exec(html);
  return head ? `${html.slice(0, head.index + head[0].length)}${tag}${html.slice(head.index + head[0].length)}` : `${tag}${html}`;
}

/**
 * A tool's web content (HTML, or a page's address), in a sandboxed web view that grows to fit:
 * scripts run, nothing is shared with the app, links open in the browser. A tool's own embed gets
 * its call's arguments as `window.args`, as on the web.
 */
export function EmbedFrame({ embed, args }: { embed: string; args?: string }) {
  const config = useServerConfig();
  const actions = useContext(EmbedActionsContext);
  const csp = typeof config.data?.ui?.iframe_csp === 'string' ? config.data.ui.iframe_csp : '';
  const address = embedAddress(embed);
  const beforeLoad = args === undefined ? undefined : `window.args = ${JSON.stringify(args)};true;`;
  return (
    <WebFrame
      {...(address ? { uri: address } : { html: withCsp(embed, csp) })}
      initialHeight={address ? 360 : 160}
      maxHeight={1200}
      measure
      beforeLoad={beforeLoad}
      onPageMessage={(message) => handleEmbedMessage(actions, message)}
    />
  );
}
