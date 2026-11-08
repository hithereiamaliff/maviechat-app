import { describe, expect, it } from 'vitest';
import { codeIdFromName, codeIdProblem, formatPythonCode, frontmatterOf, importedCode, loadCodeFromLink, requirementsOf, TOOL_TEMPLATE, FUNCTION_TEMPLATE, updateAdminFunction, updateWorkspaceTool, versionProblem } from './codeItems';
import { OwuiClient, type FetchLike } from './http';

function answering(answer: unknown) {
  const calls: { url: string; body: unknown }[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return new Response(JSON.stringify(answer), { status: 200 });
  };
  return { client: new OwuiClient({ baseUrl: 'https://x.test', token: 't', fetch }), calls };
}

const CODE = `"""
title: Weather
author: someone
requirements: requests, pytz
required_open_webui_version: 0.12.0
"""
class Tools:
    pass
`;

describe('tools’ and functions’ code', () => {
  it('saves a tool’s or a function’s code, its name and what it’s for, and nothing about sharing', async () => {
    const { client, calls } = answering({ id: 'weather' });
    await updateWorkspaceTool(client, 'weather', { name: ' Weather ', description: ' Today ', content: 'x = 1\n' });
    await updateAdminFunction(client, 'my filter', { name: 'F', description: '', content: 'y = 2\n' });
    expect(calls).toEqual([
      { url: 'https://x.test/api/v1/tools/id/weather/update', body: { id: 'weather', name: 'Weather', meta: { description: 'Today' }, content: 'x = 1\n' } },
      { url: 'https://x.test/api/v1/functions/id/my%20filter/update', body: { id: 'my filter', name: 'F', meta: { description: '' }, content: 'y = 2\n' } },
    ]);
  });

  it('loads code from a link, and formats it with the server', async () => {
    const loaded = answering({ name: 'weather', content: 'class Tools: pass\n' });
    expect(await loadCodeFromLink(loaded.client, 'tools', ' https://github.com/a/b/blob/main/weather.py ')).toEqual({ name: 'weather', content: 'class Tools: pass\n' });
    expect(loaded.calls[0]).toEqual({ url: 'https://x.test/api/v1/tools/load/url', body: { url: 'https://github.com/a/b/blob/main/weather.py' } });
    await expect(loadCodeFromLink(answering({ name: 'x', content: '' }).client, 'functions', 'https://e.x/f.py')).rejects.toThrow('no code');
    expect(await formatPythonCode(answering({ code: 'x = 1\n' }).client, 'x=1')).toBe('x = 1\n');
  });

  it('makes an id from a name as Python wants it, and says what’s wrong with one', () => {
    expect(codeIdFromName('My Weather Tool!')).toBe('my_weather_tool');
    expect(codeIdFromName('Café Menu')).toBe('cafe_menu');
    expect(codeIdFromName('3D tools')).toBe('_3d_tools');
    expect(codeIdFromName('!!!')).toBe('');
    expect(codeIdProblem('my_tool')).toBeNull();
    expect(codeIdProblem('my-tool')).toMatch(/Letters, numbers and _/);
    expect(codeIdProblem('9tool')).toMatch(/not starting with a number/);
    expect(codeIdProblem(' ')).toBe('It needs an id.');
  });

  it('reads the code’s header, and says when the server is too old for it', () => {
    expect(frontmatterOf(CODE)).toEqual({ title: 'Weather', author: 'someone', requirements: 'requests, pytz', required_open_webui_version: '0.12.0' });
    expect(frontmatterOf('class Tools: pass')).toEqual({});
    expect(requirementsOf(CODE)).toBe('requests, pytz');
    expect(versionProblem(CODE, '0.11.3')).toBe('It needs Open WebUI 0.12.0 or later; this server runs 0.11.3.');
    expect(versionProblem(CODE, '0.12.5')).toBeNull();
    expect(versionProblem('x = 1', '0.11.3')).toBeNull();
  });

  it('reads tools or functions from an export file, one or a list', () => {
    expect(importedCode([{ id: 'w', name: 'Weather', meta: { description: 'Today' }, content: 'x' }, { name: 'No code' }, { name: 'New One', content: 'y' }])).toEqual([
      { id: 'w', name: 'Weather', description: 'Today', content: 'x' },
      { id: 'new_one', name: 'New One', description: '', content: 'y' },
    ]);
    expect(importedCode({ id: 'one', name: 'One', content: 'z' })).toHaveLength(1);
    expect(importedCode('nope')).toEqual([]);
  });

  it('starts new code from the app’s own templates, with a header the server reads', () => {
    expect(frontmatterOf(TOOL_TEMPLATE).title).toBe('My Tool');
    expect(frontmatterOf(FUNCTION_TEMPLATE).title).toBe('My Filter');
    expect(TOOL_TEMPLATE).toContain('class Tools:');
    expect(FUNCTION_TEMPLATE).toContain('class Filter:');
  });
});
