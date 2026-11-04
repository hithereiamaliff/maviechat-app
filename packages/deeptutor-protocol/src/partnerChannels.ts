import { DtHttpError, type DtClient } from './http';
import { partnerTime } from './partners';

/*
 * A partner's chat apps (DeepTutor 1.7.1): each app's settings are a dict checked against that
 * app's schema; DeepTutor sends the schemas with their secret fields named. Saving replaces every
 * app's settings at once, so the app reads them whole (secrets included, for the partner's owner)
 * and never sends back a masked secret ("***"). An app that's on needs `allow_from`: who may talk
 * to the partner there. Feishu and WeCom connect by a scan (or a link on the phone); personal
 * WeChat by scanning a code with WeChat.
 */

type Tree = Record<string, unknown>;
const isTree = (value: unknown): value is Tree => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const partnerPath = (id: string) => `/api/partners/${encodeURIComponent(id)}`;

// ── Schemas as fields ────────────────────────────────────────────────────────

export type DtFieldKind = 'boolean' | 'choice' | 'lines' | 'group' | 'json' | 'integer' | 'number' | 'text';

/** One setting of a chat app, as a form shows it. */
export interface DtChannelField {
  key: string;
  /** Dotted path within the app's settings (`dm.enabled`). */
  path: string;
  label: string;
  help: string;
  kind: DtFieldKind;
  /** Choices for `choice`. */
  options: string[];
  /** May be empty (saved as null). */
  nullable: boolean;
  /** Shown hidden, with a way to reveal it. */
  secret: boolean;
  /** For `group`: its own settings. */
  fields: DtChannelField[];
  fallback: unknown;
}

const titleCase = (key: string) => key.replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());

/** A schema's settings as form fields, in its order (one that's `anyOf` uses its first non-null form). */
export function channelFields(schema: unknown, secretFields: string[] = [], prefix = ''): DtChannelField[] {
  const properties = isTree(schema) && isTree(schema.properties) ? schema.properties : {};
  return Object.entries(properties).map(([key, raw]) => {
    const declared = isTree(raw) ? raw : {};
    const variants = Array.isArray(declared.anyOf) ? declared.anyOf.filter(isTree) : [];
    const nullable = variants.some((variant) => variant.type === 'null') || declared.default === null;
    const prop: Tree = { ...(variants.find((variant) => variant.type !== 'null') ?? {}), ...declared };
    const path = prefix ? `${prefix}.${key}` : key;
    const type = text(prop.type) || text(variants.find((variant) => variant.type !== 'null')?.type);
    const items = isTree(prop.items) ? prop.items : {};
    let kind: DtFieldKind = 'text';
    if (Array.isArray(prop.enum)) kind = 'choice';
    else if (type === 'boolean') kind = 'boolean';
    else if (type === 'integer') kind = 'integer';
    else if (type === 'number') kind = 'number';
    else if (type === 'array') kind = items.type === 'string' && !Array.isArray(items.enum) ? 'lines' : 'json';
    else if (type === 'object') kind = isTree(prop.properties) && Object.keys(prop.properties).length ? 'group' : 'json';
    const fallback = 'default' in prop ? prop.default : kind === 'boolean' ? false : kind === 'lines' || (kind === 'json' && type === 'array') ? [] : kind === 'json' || kind === 'group' ? {} : kind === 'integer' || kind === 'number' ? 0 : '';
    return {
      key,
      path,
      label: text(prop.title) || titleCase(key),
      help: text(prop.description),
      kind,
      options: Array.isArray(prop.enum) ? prop.enum.map(String) : [],
      nullable,
      secret: secretFields.includes(path),
      fields: kind === 'group' ? channelFields(prop, secretFields, path) : [],
      fallback,
    };
  });
}

/** A setting's value at a dotted path, else undefined. */
export function settingAt(config: Tree, path: string): unknown {
  let node: unknown = config;
  for (const part of path.split('.')) {
    if (!isTree(node)) return undefined;
    node = node[part];
  }
  return node;
}

/** A copy of `config` with the setting at `path` changed. */
export function withSetting(config: Tree, path: string, value: unknown): Tree {
  const [head, ...rest] = path.split('.');
  if (!head) return config;
  if (!rest.length) return { ...config, [head]: value };
  const child = isTree(config[head]) ? (config[head] as Tree) : {};
  return { ...config, [head]: withSetting(child, rest.join('.'), value) };
}

/** A setting as the form shows it: what's saved, else the schema's default. */
export function shownSetting(config: Tree, field: DtChannelField): unknown {
  const value = settingAt(config, field.path);
  return value === undefined ? field.fallback : value;
}

/** Lines typed for a list setting, empty ones dropped. */
export const linesToList = (value: string): string[] =>
  value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

export interface DtChannelSchema {
  name: string;
  displayName: string;
  /** DeepTutor can run it (its add-on is installed). */
  available: boolean;
  unavailableReason: string;
  defaultConfig: Tree;
  secretFields: string[];
  fields: DtChannelField[];
  description: string;
}

/** The chat apps DeepTutor knows, by display name (read fresh: what's installed can change). */
export async function getChannelSchemas(client: DtClient): Promise<DtChannelSchema[]> {
  const raw = await client.get<unknown>('/api/partners/channels/schema');
  const channels = isTree(raw) && isTree(raw.channels) ? raw.channels : {};
  return Object.entries(channels)
    .filter((entry): entry is [string, Tree] => isTree(entry[1]))
    .map(([name, entry]) => {
      const secrets = Array.isArray(entry.secret_fields) ? entry.secret_fields.map(text).filter(Boolean) : [];
      const schema = isTree(entry.json_schema) ? entry.json_schema : null;
      return {
        name,
        displayName: text(entry.display_name) || titleCase(name),
        available: entry.available !== false,
        unavailableReason: text(entry.unavailable_reason),
        defaultConfig: isTree(entry.default_config) ? entry.default_config : {},
        secretFields: secrets,
        fields: schema ? channelFields(schema, secrets) : [],
        description: schema ? text(schema.description) : '',
      };
    })
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

// ── A partner's settings for them ────────────────────────────────────────────

/** Every chat app's settings, secrets included (for its owner). */
export async function getPartnerChannels(client: DtClient, id: string): Promise<Record<string, Tree>> {
  const raw = await client.get<unknown>(partnerPath(id), { query: { include_secrets: true } });
  const channels = isTree(raw) && isTree(raw.channels) ? raw.channels : {};
  return Object.fromEntries(Object.entries(channels).filter((entry): entry is [string, Tree] => isTree(entry[1])));
}

/** Whether a settings dict still holds a masked secret (never save one back). */
export function hasMaskedSecret(config: unknown): boolean {
  if (config === '***') return true;
  if (Array.isArray(config)) return config.some(hasMaskedSecret);
  return isTree(config) && Object.values(config).some(hasMaskedSecret);
}

/**
 * Saves every chat app's settings at once (DeepTutor replaces them whole), and restarts the
 * partner's listeners if it's running. A refusal names what's wrong: `channelErrors` reads it.
 */
export async function savePartnerChannels(client: DtClient, id: string, channels: Record<string, Tree>): Promise<void> {
  if (hasMaskedSecret(channels)) throw new Error('A secret is still hidden (***): read the settings with their secrets before saving.');
  await client.send<unknown>('PATCH', partnerPath(id), { body: { channels } });
}

/** What DeepTutor said is wrong with chat-app settings, setting by setting. */
export function channelErrors(error: unknown): string[] {
  if (!(error instanceof DtHttpError) || error.status !== 422) return [];
  const detail = isTree(error.body) ? error.body.detail : undefined;
  if (isTree(detail)) {
    if (Array.isArray(detail.errors)) {
      return detail.errors.filter(isTree).map((item) => {
        const where = Array.isArray(item.loc) ? item.loc.map(String).join('.') : '';
        return where ? `${where}: ${text(item.msg)}` : text(item.msg);
      });
    }
    // Its message names the apps already.
    if (Array.isArray(detail.channels)) return [text(detail.message) || `Nobody is allowed to talk to it in: ${detail.channels.map(String).join(', ')}`];
    if (text(detail.message)) return [text(detail.message)];
  }
  return error.detail ? [error.detail] : [];
}

export type DtChannelSetupStatus = 'connected' | 'connecting' | 'starting' | 'running' | 'waiting_for_scan' | 'action_required' | 'unavailable' | 'error' | 'disconnected' | '';

export interface DtChannelState {
  enabled: boolean;
  running: boolean;
  status: DtChannelSetupStatus;
  message: string;
  /** A code to scan, drawn by DeepTutor (a PNG data: URL), when the app wants one now. */
  qrImage: string;
  qrPayload: string;
}

/** How each chat app is doing (for its owner). */
export async function getChannelStatus(client: DtClient, id: string): Promise<{ running: boolean; channels: Record<string, DtChannelState> }> {
  const raw = await client.get<unknown>(`${partnerPath(id)}/channels/status`);
  const row = isTree(raw) ? raw : {};
  const channels = isTree(row.channels) ? row.channels : {};
  return {
    running: row.running === true,
    channels: Object.fromEntries(
      Object.entries(channels).map(([name, value]) => {
        const state = isTree(value) ? value : {};
        const setup = isTree(state.setup) ? state.setup : {};
        return [name, { enabled: state.enabled === true, running: state.running === true, status: text(setup.status) as DtChannelSetupStatus, message: text(setup.message), qrImage: text(setup.qr_data_url).startsWith('data:image/') ? text(setup.qr_data_url) : '', qrPayload: text(setup.qr_payload) }];
      }),
    ),
  };
}

/** Restarts its chat-app listeners (404 when it isn't running). */
export async function reloadPartnerChannels(client: DtClient, id: string): Promise<void> {
  await client.post<unknown>(`${partnerPath(id)}/channels/reload`);
}

// ── Connecting by a scan ─────────────────────────────────────────────────────

export type DtOnboardingStatus = 'pending_scan' | 'ready' | 'applied' | 'cancelled' | 'expired' | 'denied' | 'failed';

/** Feishu or WeCom, connected by scanning a code (or opening its link on the phone with the app). */
export interface DtOnboarding {
  id: string;
  channel: string;
  status: DtOnboardingStatus;
  /** A PNG data: URL of the code, for another device to scan. */
  qrImage: string;
  /** Opens the app's authorization on this phone. */
  link: string;
  pollSeconds: number;
  expiresAt: number | null;
  errorCode: string;
}

function onboardingOf(raw: unknown): DtOnboarding {
  const row = isTree(raw) ? raw : {};
  const seconds = typeof row.poll_interval_seconds === 'number' && row.poll_interval_seconds > 0 ? row.poll_interval_seconds : 5;
  return {
    id: text(row.session_id),
    channel: text(row.channel),
    status: (text(row.status) || 'pending_scan') as DtOnboardingStatus,
    qrImage: text(row.qr_data_url).startsWith('data:image/') ? text(row.qr_data_url) : '',
    link: /^https?:\/\//i.test(text(row.fallback_url)) ? text(row.fallback_url) : '',
    pollSeconds: seconds,
    expiresAt: partnerTime(row.expires_at),
    errorCode: text(row.error_code),
  };
}

/** Starts connecting Feishu or WeCom (an active attempt is returned again). DeepTutor asks the app's provider. */
export async function startChannelOnboarding(client: DtClient, id: string, channel: 'feishu' | 'wecom'): Promise<DtOnboarding> {
  return onboardingOf(await client.post<unknown>(`${partnerPath(id)}/channel-onboarding/start`, { channel }));
}

/** Asks the provider once whether the scan happened. */
export async function checkChannelOnboarding(client: DtClient, id: string, sessionId: string): Promise<DtOnboarding> {
  return onboardingOf(await client.get<unknown>(`${partnerPath(id)}/channel-onboarding/${encodeURIComponent(sessionId)}`));
}

export async function cancelChannelOnboarding(client: DtClient, id: string, sessionId: string): Promise<void> {
  await client.delete<unknown>(`${partnerPath(id)}/channel-onboarding/${encodeURIComponent(sessionId)}`);
}

/** Saves what the scan gave (when it's `ready`) and turns the app on. */
export async function applyChannelOnboarding(client: DtClient, id: string, sessionId: string): Promise<void> {
  await client.post<unknown>(`${partnerPath(id)}/channel-onboarding/${encodeURIComponent(sessionId)}/apply`);
}

export type DtWeixinStatus = 'waiting' | 'scanned' | 'confirmed' | 'expired' | 'error';

/** Personal WeChat, connected by scanning a code with WeChat (on another device). */
export interface DtWeixinLogin {
  id: string;
  status: DtWeixinStatus;
  error: string;
  /** An SVG of the code (empty when DeepTutor can't draw one: then `payload` is what to scan). */
  svg: string;
  payload: string;
  expiresIn: number;
}

function weixinOf(raw: unknown, previous?: DtWeixinLogin): DtWeixinLogin {
  const row = isTree(raw) ? raw : {};
  return {
    id: text(row.session_id) || previous?.id || '',
    status: (text(row.status) || 'waiting') as DtWeixinStatus,
    error: text(row.error),
    svg: text(row.qr_svg).trim().startsWith('<svg') ? text(row.qr_svg) : (previous?.svg ?? ''),
    payload: text(row.scan_payload) || previous?.payload || '',
    expiresIn: typeof row.expires_in === 'number' ? row.expires_in : 0,
  };
}

/** Starts a WeChat login: a code to scan. DeepTutor asks WeChat's service. */
export async function startWeixinLogin(client: DtClient, id: string): Promise<DtWeixinLogin> {
  return weixinOf(await client.post<unknown>(`${partnerPath(id)}/channels/weixin/qr`));
}

/** Where the login is; on `confirmed` DeepTutor has saved WeChat's token and turned the app on. */
export async function checkWeixinLogin(client: DtClient, id: string, previous: DtWeixinLogin): Promise<DtWeixinLogin> {
  return weixinOf(await client.get<unknown>(`${partnerPath(id)}/channels/weixin/qr/${encodeURIComponent(previous.id)}`), previous);
}
