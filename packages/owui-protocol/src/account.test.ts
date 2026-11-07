import { describe, expect, it } from 'vitest';
import {
  acceptedProfileImage,
  createApiKey,
  deleteApiKey,
  getApiKey,
  getUserVariables,
  gravatarUrl,
  hasOwnPicture,
  maskSecret,
  profileImageSource,
  profileOf,
  setUserStatus,
  updatePassword,
  updateProfile,
  updateUserVariables,
  userStatusOf,
  userStatusOn,
  validBirthDate,
  variablesProblem,
  variableTag,
} from './account';
import { OwuiClient, type FetchLike } from './http';

function recordingClient(answer: unknown, status = 200) {
  const calls: { method: string; url: string; body: unknown }[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ method: init?.method ?? 'GET', url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return new Response(JSON.stringify(answer), { status });
  };
  return { client: new OwuiClient({ baseUrl: 'https://x.test', token: 't', fetch }), calls };
}

describe('profile', () => {
  it('reads the session user, empty where the server has null', () => {
    const user = { id: 'u', name: 'Alif', role: 'user', email: 'a@x.test', profile_image_url: '/user.png', bio: null, gender: 'custom words', date_of_birth: '1990-02-03' };
    expect(profileOf(user)).toEqual({ name: 'Alif', profile_image_url: '/user.png', bio: '', gender: 'custom words', date_of_birth: '1990-02-03' });
  });

  it('saves all five fields, sending empty ones as null (the server clears them)', async () => {
    const { client, calls } = recordingClient({ id: 'u', name: 'Alif' });
    await updateProfile(client, { name: ' Alif ', profile_image_url: '', bio: '  ', gender: 'female', date_of_birth: '' });
    expect(calls[0]).toMatchObject({ method: 'POST', url: 'https://x.test/api/v1/auths/update/profile' });
    expect(calls[0]?.body).toEqual({ name: 'Alif', profile_image_url: '', bio: null, gender: 'female', date_of_birth: null });
  });

  it('knows which pictures the server takes', () => {
    for (const ok of ['', '/user.png', '/api/v1/users/abc/profile/image', 'https://gravatar.test/avatar/1?d=mp', 'data:image/jpeg;base64,AAAA', 'data:image/WEBP;base64,AAAA']) expect(acceptedProfileImage(ok)).toBe(true);
    for (const bad of ['/other.png', 'data:image/svg+xml;base64,AAAA', 'javascript:alert(1)', '//host/x.png', 'https://', 'file:///x.png']) expect(acceptedProfileImage(bad)).toBe(false);
  });

  it('tells your own picture from the stand-ins, and where to load it', () => {
    expect(hasOwnPicture('/user.png')).toBe(false);
    expect(hasOwnPicture('https://x.test/user.png')).toBe(false);
    expect(hasOwnPicture('')).toBe(false);
    expect(profileImageSource('data:image/png;base64,AA', 'https://x.test')).toEqual({ uri: 'data:image/png;base64,AA', authed: false });
    expect(profileImageSource('/api/v1/users/u/profile/image', 'https://x.test')).toEqual({ uri: 'https://x.test/api/v1/users/u/profile/image', authed: true });
    expect(profileImageSource('https://gravatar.test/a', 'https://x.test')).toEqual({ uri: 'https://gravatar.test/a', authed: false });
    expect(profileImageSource('https://x.test/api/v1/users/u/profile/image', 'https://x.test')?.authed).toBe(true);
    expect(profileImageSource('/user.png', 'https://x.test')).toBeNull();
  });

  it('asks the server for your Gravatar address', async () => {
    const { client, calls } = recordingClient('https://www.gravatar.com/avatar/abc?d=mp');
    expect(await gravatarUrl(client, 'a+b@x.test')).toContain('gravatar');
    expect(calls[0]?.url).toBe('https://x.test/api/v1/utils/gravatar?email=a%2Bb%40x.test');
  });

  it('checks birth dates', () => {
    expect(validBirthDate('')).toBe(true);
    expect(validBirthDate('1990-02-28')).toBe(true);
    expect(validBirthDate('1990-02-30')).toBe(false);
    expect(validBirthDate('90-2-3')).toBe(false);
    expect(validBirthDate('1890-01-01')).toBe(false);
  });
});

describe('variables', () => {
  it('reads only text values and writes them all back, CRLF made LF', async () => {
    const { client, calls } = recordingClient({ variables: { city: 'Kuala Lumpur', bad: 3 } });
    expect(await getUserVariables(client)).toEqual([{ key: 'city', value: 'Kuala Lumpur' }]);
    await updateUserVariables(client, [{ key: 'city', value: 'KL\r\nMalaysia' }]);
    expect(calls[1]).toMatchObject({ method: 'POST', url: 'https://x.test/api/v1/users/user/variables/update', body: { variables: { city: 'KL\nMalaysia' } } });
  });

  it('finds what the server would refuse', () => {
    expect(variablesProblem([{ key: 'city', value: 'KL' }, { key: 'a1_b', value: '' }])).toBeNull();
    expect(variablesProblem([{ key: 'City', value: 'KL' }])).toContain('City');
    expect(variablesProblem([{ key: '1city', value: 'KL' }])).toBeTruthy();
    expect(variablesProblem([{ key: 'city', value: 'a' }, { key: 'city', value: 'b' }])).toContain('two');
    expect(variablesProblem([{ key: 'long', value: 'x'.repeat(20_001) }])).toContain('long');
    expect(variablesProblem(Array.from({ length: 6 }, (_, index) => ({ key: `k${index}`, value: 'x'.repeat(19_000) })))).toContain('add up');
    expect(variableTag('city')).toBe('{{user.variables.city}}');
  });
});

describe('password and API key', () => {
  it('sends the current and new password under the web’s names', async () => {
    const { client, calls } = recordingClient(true);
    expect(await updatePassword(client, 'old', 'new')).toBe(true);
    expect(calls[0]).toMatchObject({ method: 'POST', url: 'https://x.test/api/v1/auths/update/password', body: { password: 'old', new_password: 'new' } });
  });

  it('reads a missing key (404) as none, and creates and deletes one', async () => {
    expect(await getApiKey(recordingClient({ detail: 'Not found' }, 404).client)).toBeNull();
    await expect(getApiKey(recordingClient({ detail: 'nope' }, 403).client)).rejects.toThrow('nope');
    expect(await getApiKey(recordingClient({ api_key: 'sk-1234567890abcdef' }).client)).toBe('sk-1234567890abcdef');
    const { client, calls } = recordingClient({ api_key: 'sk-new' });
    expect(await createApiKey(client)).toBe('sk-new');
    await deleteApiKey(client);
    expect(calls.map((call) => call.method)).toEqual(['POST', 'DELETE']);
  });

  it('masks a secret down to its start and last four', () => {
    expect(maskSecret('sk-1234567890abcdef')).toBe('sk-••••••••cdef');
    expect(maskSecret('short')).toBe('•••••');
  });
});

describe('your status', () => {
  it('reads it from the session user, and is on unless the server turns it off', () => {
    expect(userStatusOf({ status_emoji: 'grinning', status_message: 'In meetings', name: 'A' })).toEqual({ emoji: 'grinning', message: 'In meetings' });
    expect(userStatusOf({ status_emoji: null })).toEqual({ emoji: '', message: '' });
    expect(userStatusOn({ features: { enable_user_status: false } })).toBe(false);
    expect(userStatusOn({ features: {} })).toBe(true);
    expect(userStatusOn(undefined)).toBe(true);
  });

  it('sets it with the web’s fields, and clears it with both empty', async () => {
    const { client, calls } = recordingClient({ id: 'u1', status_emoji: '+1', status_message: 'Done' });
    expect(await setUserStatus(client, { emoji: '+1', message: 'Done' })).toEqual({ emoji: '+1', message: 'Done' });
    expect(calls[0]).toMatchObject({ method: 'POST', url: 'https://x.test/api/v1/users/user/status/update', body: { status_emoji: '+1', status_message: 'Done' } });
    await setUserStatus(client, { emoji: '', message: '' });
    expect(calls[1]?.body).toEqual({ status_emoji: '', status_message: '' });
  });
});
