/* Words and times for the Partners pages. */

/** A time as the sidebar shows it: "3:05 pm" today, "Mon" this week, else "4 Nov". */
export function shortWhen(ms: number | null): string {
  if (!ms) return '';
  const at = new Date(ms);
  const today = new Date();
  if (at.toDateString() === today.toDateString()) return at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const days = (today.getTime() - at.getTime()) / 86_400_000;
  if (days < 6) return at.toLocaleDateString(undefined, { weekday: 'short' });
  return at.toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...(at.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}) });
}

const CHANNEL_NAMES: Record<string, string> = {
  dingtalk: 'DingTalk',
  discord: 'Discord',
  email: 'Email',
  feishu: 'Feishu',
  matrix: 'Matrix',
  mattermost: 'Mattermost',
  mochat: 'Mochat',
  msteams: 'Microsoft Teams',
  napcat: 'NapCat',
  qq: 'QQ',
  slack: 'Slack',
  telegram: 'Telegram',
  wecom: 'WeCom',
  weixin: 'WeChat',
  whatsapp: 'WhatsApp',
  zulip: 'Zulip',
};

/** A chat app's name as people know it. */
export function channelLabel(name: string): string {
  return CHANNEL_NAMES[name] ?? name.charAt(0).toUpperCase() + name.slice(1);
}
