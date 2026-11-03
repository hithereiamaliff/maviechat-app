import type { DtClient } from './http';

/**
 * DeepTutor's learning journal (`GET /api/learning-journal`, read-only): what DeepTutor keeps
 * about your learning between chats. It writes it itself as you learn.
 */
export interface DtLearningJournal {
  updated_at: string;
  /** Your goal: the topic, why, and your level. */
  mission: { topic: string; why: string; level: string; updated_at: string };
  /** Where the last session left off, and what's next. */
  last_session: { summary: string; next_focus: string; updated_at: string };
  /** Things learned along the way, newest first. */
  records: { id: string; title: string; insight: string; created_at: string }[];
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const record = (value: unknown): Record<string, unknown> => (typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {});

export async function getLearningJournal(client: DtClient): Promise<DtLearningJournal> {
  const raw = record(await client.get<unknown>('/api/learning-journal'));
  const mission = record(raw.mission);
  const session = record(raw.last_session);
  return {
    updated_at: text(raw.updated_at),
    mission: { topic: text(mission.topic), why: text(mission.why), level: text(mission.level), updated_at: text(mission.updated_at) },
    last_session: { summary: text(session.summary), next_focus: text(session.next_focus), updated_at: text(session.updated_at) },
    records: (Array.isArray(raw.records) ? raw.records : []).flatMap((item) => {
      const entry = record(item);
      return text(entry.title) || text(entry.insight)
        ? [{ id: text(entry.id), title: text(entry.title), insight: text(entry.insight), created_at: text(entry.created_at) }]
        : [];
    }),
  };
}

/** True when DeepTutor hasn't written anything yet. */
export function journalIsEmpty(journal: DtLearningJournal): boolean {
  const { mission, last_session: session } = journal;
  return !mission.topic && !mission.why && !mission.level && !session.summary && !session.next_focus && journal.records.length === 0;
}
