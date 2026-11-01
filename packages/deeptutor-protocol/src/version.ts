import support from './support.json';
import type { DtClient } from './http';

/** The DeepTutor release this server runs (`GET /api/system/update`, signed in), or null if it didn't say. */
export async function getServerVersion(client: DtClient): Promise<string | null> {
  const response = await client.get<{ current_version?: unknown }>('/api/system/update');
  return typeof response.current_version === 'string' ? response.current_version : null;
}

/** Whether MavieChat's DeepTutor probe has passed against this release. */
export function isValidatedVersion(version: string | null | undefined): boolean {
  return Boolean(version) && version === support.maxValidated;
}
