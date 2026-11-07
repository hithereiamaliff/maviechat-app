import type { FeatureToggles } from '@maviechat/owui-protocol';

/**
 * A link into a new chat, read as the web reads its own address: `maviechat://?q=Hello&models=a,b
 * &web-search=true&tools=x&temporary-chat=true` fills the new chat as `/?q=…` does on the web, and
 * `load-url=https://…` or `youtube=VIDEO_ID` attach that page (the video's transcript).
 * One difference: the web sends `q` at once unless `submit=false`. Here it only goes in the
 * message box, because any app or page can open a `maviechat://` link; you send it.
 */
export interface ChatLink {
  /** Models to start with: `models`, else `model` (Workspace's Try in Chat uses that). */
  models: string[];
  /** Text for the message box (`q`). */
  text: string | null;
  /** `web-search`, `image-generation` and `code-interpreter` set to `true`. */
  toggles: FeatureToggles;
  /** `tools`, else `tool-ids`. */
  toolIds: string[];
  /** `temporary-chat=true`, where the account may start one. */
  temporary: boolean;
  /** Pages to attach, as Attach Webpage does: `youtube` (a video's id) and `load-url`. */
  pages: string[];
  /** The same for the same link, so the screen starts over when another one comes in. */
  key: string;
}

type Params = Record<string, string | string[] | undefined>;

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
const list = (value: string | string[] | undefined) =>
  (one(value) ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

export function chatLinkFrom(params: Params): ChatLink {
  const models = list(params.models).length ? list(params.models) : list(params.model);
  const q = one(params.q);
  const text = q ? q : null;
  const toggles: FeatureToggles = {
    ...(one(params['web-search']) === 'true' ? { webSearch: true } : {}),
    ...(one(params['image-generation']) === 'true' ? { imageGeneration: true } : {}),
    ...(one(params['code-interpreter']) === 'true' ? { codeInterpreter: true } : {}),
  };
  const toolIds = list(params.tools).length ? list(params.tools) : list(params['tool-ids']);
  const temporary = one(params['temporary-chat']) === 'true';
  const pages = [youtubePage(one(params.youtube)), webPage(one(params['load-url']))].filter((page): page is string => page !== null);
  return { models, text, toggles, toolIds, temporary, pages, key: JSON.stringify([models, text, toggles, toolIds, temporary, pages]) };
}

/** A video's page from its id, as the web builds it (a whole YouTube address is taken as it is). */
function youtubePage(value: string | undefined): string | null {
  const id = value?.trim() ?? '';
  if (/^[\w-]{6,20}$/.test(id)) return `https://www.youtube.com/watch?v=${id}`;
  return webPage(id) && /^https:\/\/(www\.|m\.)?(youtube\.com|youtu\.be)\//i.test(id) ? id : null;
}

/** A web address to attach: http or https only. */
function webPage(value: string | undefined): string | null {
  const url = value?.trim() ?? '';
  return /^https?:\/\/[^\s/]+\.[^\s]+$/i.test(url) ? url : null;
}

/** Whether the link puts anything in the input bar: a message, switches, tools or pages. */
export const linkFillsInput = (link: ChatLink): boolean => link.text !== null || Object.keys(link.toggles).length > 0 || link.toolIds.length > 0 || link.pages.length > 0;
