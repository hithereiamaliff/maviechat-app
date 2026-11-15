import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * app.json, plus Firebase's Android file, which stays out of the repo (it's going public): EAS
 * Build gets it from the `GOOGLE_SERVICES_JSON` file variable, and this machine keeps the same file
 * at ~/.config/maviechat/google-services.json for updates. The fingerprint hashes the file's
 * contents only (not its path), so builds and updates agree on Android's runtime. Without the
 * file, Android has no FCM, so no notifications; iOS doesn't read it.
 */
export default ({ config }: ConfigContext): ExpoConfig => {
  const local = join(homedir(), '.config/maviechat/google-services.json');
  const file = process.env.GOOGLE_SERVICES_JSON || (existsSync(local) ? local : undefined);
  const base = config as ExpoConfig;
  return file ? { ...base, android: { ...base.android, googleServicesFile: file } } : base;
};
