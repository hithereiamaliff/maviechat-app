/** Expo's push service: the app's push tokens are Expo's, and Expo hands the notifications to Apple. */
export const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface PushMessage {
  to: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  /** Groups a session's notifications together on the phone. */
  threadId?: string;
}

/** An Expo push token, as the app sends it. */
export const isPushToken = (value: unknown): value is string => typeof value === 'string' && value.length <= 256 && /^Expo(?:nent)?PushToken\[[A-Za-z0-9_-]+\]$/.test(value);

/** Sends notifications through Expo. Answers with the tokens Expo says are gone (the app was removed). */
export async function sendPushes(fetchImpl: Fetch, messages: PushMessage[]): Promise<{ gone: string[] }> {
  const response = await fetchImpl(EXPO_PUSH_URL, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(messages.map((message) => ({ ...message, sound: 'default', priority: 'high' }))),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Expo answered ${response.status}`);
  const answer = (await response.json()) as { data?: { status?: unknown; details?: { error?: unknown } }[] };
  const tickets = Array.isArray(answer.data) ? answer.data : [];
  return {
    gone: tickets.flatMap((ticket, index) => {
      const message = messages[index];
      return ticket?.status === 'error' && ticket.details?.error === 'DeviceNotRegistered' && message ? [message.to] : [];
    }),
  };
}
