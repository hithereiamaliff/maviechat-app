import { describe, expect, it } from 'vitest';
import { DtClient, DtHttpError, type FetchLike } from './http';
import {
  channelErrors,
  channelFields,
  checkWeixinLogin,
  getChannelSchemas,
  getChannelStatus,
  getPartnerChannels,
  hasMaskedSecret,
  linesToList,
  savePartnerChannels,
  settingAt,
  shownSetting,
  startChannelOnboarding,
  startWeixinLogin,
  withSetting,
} from './partnerChannels';

function recordingClient(answer: unknown, status = 200) {
  const calls: { method: string; url: string; body: unknown }[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ method: init?.method ?? 'GET', url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return new Response(JSON.stringify(answer), { status });
  };
  return { client: new DtClient({ baseUrl: 'https://learn.test', token: 't', fetch }), calls };
}

const TELEGRAM = {
  description: 'Telegram channel configuration.',
  properties: {
    enabled: { default: false, title: 'Enabled', type: 'boolean' },
    token: { default: '', title: 'Token', type: 'string' },
    allow_from: { items: { type: 'string' }, title: 'Allow From', type: 'array' },
    proxy: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null, title: 'Proxy' },
    group_policy: { default: 'mention', enum: ['open', 'mention'], title: 'Group Policy', type: 'string' },
    chat_policies: { description: 'Per-chat overrides.', items: { properties: { chat_id: { type: 'integer' } }, type: 'object' }, type: 'array' },
    pool_timeout: { default: 5, type: 'number' },
    dm: { properties: { enabled: { default: true, type: 'boolean' }, secret_word: { type: 'string', default: '' } }, type: 'object' },
    groups: { type: 'object' },
  },
};

describe('chat-app settings as fields', () => {
  it('turns a schema into form fields, in its order, with secrets named', () => {
    const fields = channelFields(TELEGRAM, ['token', 'dm.secret_word']);
    expect(fields.map((field) => [field.key, field.kind])).toEqual([
      ['enabled', 'boolean'],
      ['token', 'text'],
      ['allow_from', 'lines'],
      ['proxy', 'text'],
      ['group_policy', 'choice'],
      ['chat_policies', 'json'],
      ['pool_timeout', 'number'],
      ['dm', 'group'],
      ['groups', 'json'],
    ]);
    expect(fields[1]).toMatchObject({ label: 'Token', secret: true, nullable: false });
    expect(fields[3]).toMatchObject({ nullable: true, fallback: null });
    expect(fields[4]?.options).toEqual(['open', 'mention']);
    expect(fields[5]).toMatchObject({ label: 'Chat Policies', help: 'Per-chat overrides.', fallback: [] });
    expect(fields[7]?.fields.map((field) => [field.path, field.secret])).toEqual([
      ['dm.enabled', false],
      ['dm.secret_word', true],
    ]);
  });

  it('reads and changes settings by dotted path, with defaults where none is saved', () => {
    const fields = channelFields(TELEGRAM);
    const config = { token: 'abc', dm: { enabled: false } };
    expect(settingAt(config, 'dm.enabled')).toBe(false);
    expect(withSetting(config, 'dm.enabled', true)).toEqual({ token: 'abc', dm: { enabled: true } });
    expect(withSetting({}, 'dm.secret_word', 'x')).toEqual({ dm: { secret_word: 'x' } });
    expect(shownSetting(config, fields.find((field) => field.key === 'group_policy')!)).toBe('mention');
    expect(linesToList(' 123 \n\n*\n')).toEqual(['123', '*']);
  });

  it('reads the schemas by name, noting apps DeepTutor can’t run', async () => {
    const schemas = await getChannelSchemas(
      recordingClient({
        channels: {
          telegram: { name: 'telegram', display_name: 'Telegram', available: true, secret_fields: ['token'], default_config: { enabled: false }, json_schema: TELEGRAM },
          matrix: { name: 'matrix', display_name: 'Matrix', available: false, unavailable_reason: 'Not installed', json_schema: null, default_config: { enabled: false }, secret_fields: [] },
        },
      }).client,
    );
    expect(schemas.map((schema) => [schema.name, schema.available])).toEqual([
      ['matrix', false],
      ['telegram', true],
    ]);
    expect(schemas[1]).toMatchObject({ description: 'Telegram channel configuration.', secretFields: ['token'] });
    expect(schemas[0]).toMatchObject({ unavailableReason: 'Not installed', fields: [] });
  });
});

describe('a partner’s chat apps', () => {
  it('reads them with their secrets, and saves them whole, never a masked secret', async () => {
    const { client, calls } = recordingClient({ partner_id: 'ada', channels: { telegram: { enabled: true, token: 'real' }, junk: 'x' } });
    expect(await getPartnerChannels(client, 'ada')).toEqual({ telegram: { enabled: true, token: 'real' } });
    expect(calls[0]?.url).toBe('https://learn.test/api/partners/ada?include_secrets=true');
    await savePartnerChannels(client, 'ada', { telegram: { enabled: false, token: 'real' } });
    expect(calls[1]).toMatchObject({ method: 'PATCH', body: { channels: { telegram: { enabled: false, token: 'real' } } } });
    expect(hasMaskedSecret({ slack: { bot_token: '***' } })).toBe(true);
    await expect(savePartnerChannels(client, 'ada', { slack: { nested: { app_token: '***' } } })).rejects.toThrow('hidden');
    expect(calls).toHaveLength(2);
  });

  it('says what’s wrong, setting by setting', () => {
    const fields = new DtHttpError(422, 'Invalid', '/x', undefined, { detail: { message: 'Invalid channel configuration', errors: [{ loc: ['telegram', 'token'], msg: 'Field required' }] } });
    expect(channelErrors(fields)).toEqual(['telegram.token: Field required']);
    const empty = new DtHttpError(422, 'x', '/x', undefined, { detail: { message: 'Enabled channels require at least one allowed sender: telegram', channels: ['telegram'] } });
    expect(channelErrors(empty)).toEqual(['Enabled channels require at least one allowed sender: telegram']);
    expect(channelErrors(new DtHttpError(422, 'x', '/x', undefined, { detail: { channels: ['slack'] } }))).toEqual(['Nobody is allowed to talk to it in: slack']);
    expect(channelErrors(new DtHttpError(500, 'boom', '/x'))).toEqual([]);
  });

  it('reads how each app is doing', async () => {
    const status = await getChannelStatus(
      recordingClient({ partner_id: 'ada', running: true, channels: { whatsapp: { enabled: true, running: false, setup: { status: 'waiting_for_scan', message: 'Scan with WhatsApp', qr_data_url: 'data:image/png;base64,AA', qr_payload: '2@abc' } }, slack: { enabled: false } } }).client,
      'ada',
    );
    expect(status.running).toBe(true);
    expect(status.channels.whatsapp).toEqual({ enabled: true, running: false, status: 'waiting_for_scan', message: 'Scan with WhatsApp', qrImage: 'data:image/png;base64,AA', qrPayload: '2@abc' });
    expect(status.channels.slack).toMatchObject({ enabled: false, status: '', qrImage: '' });
  });
});

describe('connecting by a scan', () => {
  it('starts Feishu or WeCom, with the link to open on the phone', async () => {
    const { client, calls } = recordingClient({ session_id: 's1', channel: 'wecom', status: 'pending_scan', qr_data_url: 'data:image/png;base64,AA', fallback_url: 'https://work.weixin.qq.com/x', poll_interval_seconds: 3, expires_at: '2026-11-04T08:00:00+00:00' });
    const started = await startChannelOnboarding(client, 'ada', 'wecom');
    expect(calls[0]).toMatchObject({ method: 'POST', url: 'https://learn.test/api/partners/ada/channel-onboarding/start', body: { channel: 'wecom' } });
    expect(started).toMatchObject({ id: 's1', status: 'pending_scan', link: 'https://work.weixin.qq.com/x', pollSeconds: 3, expiresAt: Date.UTC(2026, 10, 4, 8) });
  });

  it('keeps WeChat’s code while it polls, as DeepTutor sends it only when new', async () => {
    const started = await startWeixinLogin(recordingClient({ session_id: 'w1', status: 'waiting', expires_in: 600, scan_payload: 'https://liteapp/x', qr_svg: '<svg></svg>' }).client, 'ada');
    expect(started).toMatchObject({ id: 'w1', svg: '<svg></svg>', payload: 'https://liteapp/x' });
    const { client, calls } = recordingClient({ session_id: 'w1', status: 'scanned', expires_in: 500 });
    const next = await checkWeixinLogin(client, 'ada', started);
    expect(calls[0]?.url).toBe('https://learn.test/api/partners/ada/channels/weixin/qr/w1');
    expect(next).toMatchObject({ status: 'scanned', svg: '<svg></svg>', payload: 'https://liteapp/x' });
  });
});
