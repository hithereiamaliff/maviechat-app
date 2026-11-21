import { describe, expect, it, vi } from 'vitest';
import { REPLY_LIMIT, REPORT_FORM, REPORT_URL, reportBody, reportFields, reportIntro, sendReport, serverComment, type ReportInput } from './report';

const input = (change: Partial<ReportInput> = {}): ReportInput => ({
  subject: { space: 'owui', server: 'chat.example.com', model: 'Travel Planner', reply: 'Day 1: George Town & murals\nDay 2: hills' },
  reason: 'offensive',
  note: '  It insulted me  ',
  includeReply: true,
  app: { version: '1.0.0', platform: 'Android', update: 'built-in' },
  ...change,
});

describe('reportFields', () => {
  it('names the form, leaves the honeypot empty and sends only what the sheet shows', () => {
    const fields = Object.fromEntries(reportFields(input()));
    expect(fields['form-name']).toBe(REPORT_FORM);
    expect(fields['bot-field']).toBe('');
    expect(fields.reason).toBe('Offensive or hateful');
    expect(fields.note).toBe('It insulted me');
    expect(fields.space).toBe('Open WebUI');
    expect(fields.server).toBe('chat.example.com');
    expect(fields.model).toBe('Travel Planner');
    expect(fields.reply).toContain('George Town');
    expect(fields.app).toBe('MavieChat 1.0.0 (Android, built-in)');
    expect(Object.keys(fields)).toEqual(['form-name', 'bot-field', 'reason', 'note', 'space', 'server', 'model', 'reply', 'app']);
  });

  it("leaves the reply's text out when the switch is off", () => {
    expect(Object.fromEntries(reportFields(input({ includeReply: false }))).reply).toBe('(not included)');
  });

  it('cuts a long reply down', () => {
    const long = 'x'.repeat(REPLY_LIMIT + 50);
    const reply = Object.fromEntries(reportFields(input({ subject: { space: 'deeptutor', server: 'learn.example.com', reply: long } }))).reply;
    expect(reply).toHaveLength(REPLY_LIMIT);
    expect(reply.endsWith('…')).toBe(true);
  });

  it('sends no model when the app has none', () => {
    expect(Object.fromEntries(reportFields(input({ subject: { space: 'deeptutor', server: 'learn.example.com', reply: 'A' } }))).model).toBe('');
  });
});

describe('reportBody', () => {
  it('URL-encodes every field', () => {
    const body = reportBody(reportFields(input()));
    expect(body.startsWith(`form-name=${REPORT_FORM}&bot-field=&reason=Offensive%20or%20hateful`)).toBe(true);
    expect(body).toContain('George%20Town%20%26%20murals%0ADay%202');
    const parsed = new URLSearchParams(body);
    expect(parsed.get('reply')).toBe('Day 1: George Town & murals\nDay 2: hills');
  });
});

describe('sendReport', () => {
  it('posts the form to the website', async () => {
    const send = vi.fn(async () => new Response('ok', { status: 200 }));
    await sendReport(input(), send as unknown as typeof fetch);
    expect(send).toHaveBeenCalledTimes(1);
    const [url, init] = send.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(REPORT_URL);
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(String(init.body)).toContain(`form-name=${REPORT_FORM}`);
  });

  it("fails when the website doesn't take it", async () => {
    const send = vi.fn(async () => new Response('missing', { status: 404 }));
    await expect(sendReport(input(), send as unknown as typeof fetch)).rejects.toThrow('404');
  });

  it('gives up after the time limit', async () => {
    const send = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    await expect(sendReport(input(), send as unknown as typeof fetch, 10)).rejects.toThrow('it took too long');
  });
});

describe('serverComment and reportIntro', () => {
  it("tells the server's admins why, with the note when there is one", () => {
    expect(serverComment('sexual', '')).toBe('Reported in MavieChat: Sexual content');
    expect(serverComment('other', ' Made up a quote ')).toBe('Reported in MavieChat: Something else. Made up a quote');
  });

  it('says who chose the AI, and whether the admins hear of it', () => {
    expect(reportIntro({ space: 'owui', server: 'chat.example.com' }, true)).toContain('Whoever runs chat.example.com chooses its AI models, and its admins will see your report too.');
    expect(reportIntro({ space: 'deeptutor', server: 'learn.example.com' }, false)).toContain('Whoever runs learn.example.com chooses its AI models.');
    expect(reportIntro({ space: 'opencode', server: 'code.example.com' }, false)).toContain('set up in OpenCode on your computer');
  });
});
