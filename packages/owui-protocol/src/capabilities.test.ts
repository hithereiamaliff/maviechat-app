import { describe, expect, it } from 'vitest';
import { buildCapabilities } from './capabilities';
import type { ServerConfig } from './server';

const config: ServerConfig = {
  name: 'Test',
  version: '0.11.3',
  features: {
    enable_web_search: true,
    enable_image_generation: false,
    enable_code_interpreter: true,
    enable_code_execution: true,
    enable_folders: true,
    enable_message_rating: true,
    enable_websocket: true,
    websocket_heartbeat_interval: 20,
  },
};

const userPermissions = {
  chat: { multiple_models: false, rate_response: true },
  features: { web_search: true, image_generation: true, code_interpreter: false, folders: true },
};

describe('buildCapabilities', () => {
  it('needs both the admin flag and the user permission', () => {
    const caps = buildCapabilities({ config, user: { role: 'user', permissions: userPermissions } });
    expect(caps.feature('webSearch')).toBe(true);
    expect(caps.feature('imageGeneration')).toBe(false); // flag off
    expect(caps.feature('codeInterpreter')).toBe(false); // permission off
    expect(caps.feature('folders')).toBe(true);
    expect(caps.feature('messageRating')).toBe(true);
    expect(caps.feature('notes')).toBe(false); // flag missing
  });

  it('flag-only features ignore permissions', () => {
    const caps = buildCapabilities({ config, user: { role: 'user', permissions: {} } });
    expect(caps.feature('codeExecution')).toBe(true);
  });

  it('admins bypass permissions but not admin flags', () => {
    const caps = buildCapabilities({ config, user: { role: 'admin', permissions: {} } });
    expect(caps.isAdmin).toBe(true);
    expect(caps.feature('codeInterpreter')).toBe(true);
    expect(caps.feature('imageGeneration')).toBe(false);
    expect(caps.can('chat.multiple_models')).toBe(true);
  });

  it('reads dotted permission paths', () => {
    const caps = buildCapabilities({ config, user: { role: 'user', permissions: userPermissions } });
    expect(caps.can('chat.rate_response')).toBe(true);
    expect(caps.can('chat.multiple_models')).toBe(false);
    expect(caps.can('chat.missing')).toBe(false);
    expect(caps.can('features.web_search.deeper')).toBe(false);
  });

  it('reports version support, pending users and socket settings', () => {
    const caps = buildCapabilities({ config, user: { role: 'pending', permissions: null }, version: '0.11.3' });
    expect(caps.version).toBe('0.11.3');
    expect(caps.support).toBe('supported');
    expect(caps.isPending).toBe(true);
    expect(caps.websocketOnly).toBe(true);
    expect(caps.heartbeatIntervalSec).toBe(20);
    expect(caps.hidden('chat.archive')).toBe(false);
  });

  it('falls back to polling and a 30 s heartbeat when the server says so or says nothing', () => {
    const caps = buildCapabilities({
      config: { features: { enable_websocket: false } },
      user: { role: 'user', permissions: {} },
    });
    expect(caps.websocketOnly).toBe(false);
    expect(caps.heartbeatIntervalSec).toBe(30);
    expect(caps.support).toBe('unknown');
  });
});
