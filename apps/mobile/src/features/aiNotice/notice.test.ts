import { describe, expect, it } from 'vitest';
import { hostOf, isNotSent, listOf, NotSentError, openCodeNotice, parseAccepted, serverNotice } from './notice';

describe('serverNotice', () => {
  it('names the server, never its AI services, and keys it per space and server', () => {
    const notice = serverNotice('owui', 'https://chat.example.com');
    expect(notice.key).toBe('owui https://chat.example.com');
    expect(notice.message).toContain('goes to chat.example.com.');
    expect(notice.message).toContain('AI services from other companies');
    expect(notice.message).toContain('Whoever runs the server chooses those services');
    expect(serverNotice('deeptutor', 'https://chat.example.com').key).toBe('deeptutor https://chat.example.com');
  });

  it('treats one server typed two ways as the same', () => {
    expect(serverNotice('owui', ' https://Chat.Example.com/ ').key).toBe(serverNotice('owui', 'https://chat.example.com').key);
  });

  it('keeps a port and drops a path from the name shown', () => {
    expect(serverNotice('deeptutor', 'http://192.168.1.5:8001/app').message).toContain('goes to 192.168.1.5:8001.');
    expect(hostOf('https://learn.example.com/?x=1')).toBe('learn.example.com');
  });
});

describe('openCodeNotice', () => {
  const machine = { gatewayUrl: 'https://code.example.com/', machineName: 'Studio Mac', loginId: 'root' };

  it('names the computer and the providers set up there, once each', () => {
    const notice = openCodeNotice(machine, ['Anthropic', 'OpenCode Go', 'Anthropic', ' ']);
    expect(notice.key).toBe('opencode https://code.example.com root');
    expect(notice.message).toContain('goes to Studio Mac.');
    expect(notice.message).toContain('to the AI providers set up there (Anthropic and OpenCode Go).');
  });

  it('still says where it goes before the providers are known', () => {
    expect(openCodeNotice(machine, []).message).toContain('to the AI providers set up there.');
  });

  it('asks again for another login on the same machine', () => {
    expect(openCodeNotice({ ...machine, loginId: 'agentbox' }, []).key).not.toBe(openCodeNotice(machine, []).key);
  });
});

describe('listOf', () => {
  it('joins names the way the app writes lists', () => {
    expect(listOf([])).toBe('');
    expect(listOf(['A'])).toBe('A');
    expect(listOf(['A', 'B'])).toBe('A and B');
    expect(listOf(['A', 'B', 'C'])).toBe('A, B and C');
  });
});

describe('parseAccepted', () => {
  it('reads the stored list and ignores anything else', () => {
    expect([...parseAccepted('["owui https://a", 3, "deeptutor https://b"]')]).toEqual(['owui https://a', 'deeptutor https://b']);
    expect(parseAccepted(null).size).toBe(0);
    expect(parseAccepted('{"a":1}').size).toBe(0);
    expect(parseAccepted('not json').size).toBe(0);
  });
});

describe('NotSentError', () => {
  it('marks a send stopped at Not Now', () => {
    expect(isNotSent(new NotSentError())).toBe(true);
    expect(isNotSent(new Error('you chose Not Now'))).toBe(false);
  });
});
