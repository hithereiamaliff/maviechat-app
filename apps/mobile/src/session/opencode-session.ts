/** A machine's OpenCode login as the app keeps it in the Keychain: the gateway, this phone's device token, and which login. */
export interface StoredOcSession {
  version: 1;
  gatewayUrl: string;
  token: string;
  deviceId: string;
  machineName: string;
  login: { id: string; name: string };
}

export function parseStoredOcSession(raw: string | null): StoredOcSession | null {
  if (!raw) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== 'object' || data === null) return null;
  const value = data as Partial<StoredOcSession>;
  const login = value.login as Partial<StoredOcSession['login']> | undefined;
  if (
    value.version !== 1 ||
    typeof value.gatewayUrl !== 'string' ||
    typeof value.token !== 'string' ||
    typeof value.deviceId !== 'string' ||
    typeof value.machineName !== 'string' ||
    !login ||
    typeof login.id !== 'string' ||
    typeof login.name !== 'string'
  ) {
    return null;
  }
  return value as StoredOcSession;
}

/** How an OpenCode account is named in lists: the machine, and the login when the machine has several. */
export function ocAccountName(machineName: string, loginName: string, logins: number): string {
  return logins > 1 ? `${machineName} · ${loginName}` : machineName;
}
