const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const pad = (value: number) => String(value).padStart(2, '0');

export interface VariableInput {
  name: string;
  email?: string;
  /** Only when the user allowed location; otherwise "Unknown". */
  location?: string;
  language?: string;
  timeZone?: string;
}

/**
 * The prompt template variables the web app sends with every turn (`variables`),
 * in the same formats: date `YYYY-MM-DD`, 24-hour time `HH:MM:SS`, English weekday.
 */
export function templateVariables(input: VariableInput, now: Date = new Date()): Record<string, string> {
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  return {
    '{{USER_NAME}}': input.name,
    '{{USER_EMAIL}}': input.email || 'Unknown',
    '{{USER_LOCATION}}': input.location || 'Unknown',
    '{{CURRENT_DATETIME}}': `${date} ${time}`,
    '{{CURRENT_DATE}}': date,
    '{{CURRENT_TIME}}': time,
    '{{CURRENT_WEEKDAY}}': WEEKDAYS[now.getDay()] as string,
    '{{CURRENT_TIMEZONE}}': input.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    '{{USER_LANGUAGE}}': input.language || 'en-US',
  };
}
