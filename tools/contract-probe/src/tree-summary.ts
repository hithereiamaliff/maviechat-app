/** Structure of a saved chat's history tree: counts and key names only, never text or ids. */
export interface TreeSummary {
  messageCount: number;
  roles: Record<string, number>;
  branchPoints: number;
  multiModelTurns: number;
  withOutput: number;
  withModelIdx: number;
  outputItemTypes: string[];
  messageKeys: string[];
  hasCurrentId: boolean;
  chatKeys: string[];
  innerKeys: string[];
}

export function summarizeTree(chat: Record<string, unknown>): TreeSummary {
  const inner = asRecord(chat.chat);
  const history = asRecord(inner.history);
  const messages = Object.values(asRecord(history.messages)).map(asRecord);

  const roles: Record<string, number> = {};
  const outputTypes = new Set<string>();
  const keys = new Set<string>();
  let branchPoints = 0;
  let multiModelTurns = 0;
  let withOutput = 0;
  let withModelIdx = 0;

  for (const message of messages) {
    for (const key of Object.keys(message)) keys.add(key);
    const role = typeof message.role === 'string' ? message.role : 'unknown';
    roles[role] = (roles[role] ?? 0) + 1;
    if (Array.isArray(message.childrenIds) && message.childrenIds.length > 1) branchPoints += 1;
    if (Array.isArray(message.models) && message.models.length > 1) multiModelTurns += 1;
    if (typeof message.modelIdx === 'number') withModelIdx += 1;
    if (Array.isArray(message.output)) {
      withOutput += 1;
      for (const item of message.output) {
        const type = asRecord(item).type;
        if (typeof type === 'string') outputTypes.add(type);
      }
    }
  }

  return {
    messageCount: messages.length,
    roles,
    branchPoints,
    multiModelTurns,
    withOutput,
    withModelIdx,
    outputItemTypes: [...outputTypes].sort(),
    messageKeys: [...keys].sort(),
    hasCurrentId: typeof history.currentId === 'string',
    chatKeys: Object.keys(chat).sort(),
    innerKeys: Object.keys(inner).sort(),
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
