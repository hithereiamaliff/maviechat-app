import type { SessionUser } from './auth';
import { featureFlag, featureNumber, type ServerConfig } from './server';
import { supportStatus, type SupportStatus } from './version';

/**
 * Features the web app shows only when the admin flag is on in `/api/config`
 * and the user is an admin or holds the permission. Names checked against
 * Open WebUI 0.11.3 (`features` in `/api/config`, `DEFAULT_USER_PERMISSIONS`).
 */
export const FEATURES = {
  webSearch: { flag: 'enable_web_search', permission: 'features.web_search' },
  imageGeneration: { flag: 'enable_image_generation', permission: 'features.image_generation' },
  codeInterpreter: { flag: 'enable_code_interpreter', permission: 'features.code_interpreter' },
  codeExecution: { flag: 'enable_code_execution', permission: null },
  folders: { flag: 'enable_folders', permission: 'features.folders' },
  notes: { flag: 'enable_notes', permission: 'features.notes' },
  channels: { flag: 'enable_channels', permission: 'features.channels' },
  memories: { flag: 'enable_memories', permission: 'features.memories' },
  apiKeys: { flag: 'enable_api_keys', permission: 'features.api_keys' },
  automations: { flag: 'enable_automations', permission: 'features.automations' },
  calendar: { flag: 'enable_calendar', permission: 'features.calendar' },
  userWebhooks: { flag: 'enable_user_webhooks', permission: 'features.webhooks' },
  messageRating: { flag: 'enable_message_rating', permission: 'chat.rate_response' },
} as const satisfies Record<string, { flag: string; permission: string | null }>;

export type FeatureId = keyof typeof FEATURES;

export interface Capabilities {
  readonly version: string | undefined;
  readonly support: SupportStatus;
  readonly isAdmin: boolean;
  readonly isPending: boolean;
  /** Admin flag on, and the user is an admin or permitted. */
  feature(id: FeatureId): boolean;
  /**
   * The user is an admin, or the permission at a dotted path (e.g. `chat.multiple_models`) is true.
   * `fallback` applies when the server doesn't list the permission (the web treats some as allowed).
   */
  can(permissionPath: string, fallback?: boolean): boolean;
  /**
   * Controls the admin hid for non-admins. Open WebUI 0.12 adds `config.ui.visibility`;
   * 0.11.x has no such list, so nothing is hidden. Implement when validating 0.12 (M5).
   */
  hidden(controlId: string): boolean;
  /** `features.enable_websocket`: the server accepts only the websocket transport. */
  readonly websocketOnly: boolean;
  readonly heartbeatIntervalSec: number;
}

export interface CapabilityInput {
  config: ServerConfig;
  user: Pick<SessionUser, 'role' | 'permissions'>;
  /** From `/api/version`; falls back to `config.version`. */
  version?: string | null;
}

export function buildCapabilities({ config, user, version }: CapabilityInput): Capabilities {
  const resolvedVersion = version ?? config.version;
  const isAdmin = user.role === 'admin';
  const permissions = user.permissions ?? {};
  const can = (permissionPath: string, fallback = false) => isAdmin || (readPath(permissions, permissionPath) ?? fallback) === true;

  return {
    version: resolvedVersion ?? undefined,
    support: supportStatus(resolvedVersion),
    isAdmin,
    isPending: user.role === 'pending',
    feature: (id) => {
      const { flag, permission } = FEATURES[id];
      return featureFlag(config, flag) && (permission === null || can(permission));
    },
    can,
    hidden: () => false,
    websocketOnly: config.features?.enable_websocket !== false,
    heartbeatIntervalSec: featureNumber(config, 'websocket_heartbeat_interval', 30),
  };
}

function readPath(tree: Record<string, unknown>, path: string): unknown {
  let node: unknown = tree;
  for (const key of path.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = (node as Record<string, unknown>)[key];
  }
  return node;
}
