import type { OwuiClient } from './http';

/** A tool from `GET /api/v1/tools/` that can be switched on for a message (`tool_ids`). */
export interface ToolItem {
  id: string;
  name: string;
  meta?: { description?: string | null; [key: string]: unknown } | null;
  [key: string]: unknown;
}

export async function listTools(client: OwuiClient): Promise<ToolItem[]> {
  return (await client.get<ToolItem[] | null>('/api/v1/tools/')) ?? [];
}
