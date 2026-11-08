import {
  audienceLine,
  audienceOf,
  createEventWebhook,
  DEFAULT_EVENT_WEBHOOK_ID,
  deleteEventWebhook,
  eventFilterProblem,
  eventsLine,
  getUserInfo,
  listAdminGroups,
  listEventKinds,
  listEventWebhooks,
  searchUsers,
  updateEventWebhook,
  webhookHost,
  webhookName,
  type EventKind,
  type EventWebhook,
  type EventWebhookFields,
  type EventWebhookTarget,
  type WebhookAudience,
} from '@maviechat/owui-protocol';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { Icon } from '@/components/Icon';
import { Modal } from '@/components/Modal';
import { useToast } from '@/components/Toast';
import { PUSH_RELAY_URL } from '@/features/notifications/relay';
import { ActionRow, Group, Note, SectionTitle } from '@/features/settings/rows';
import { describeError } from '@/lib/errors';
import { useAuthed } from '@/lib/server';
import { useDebounced } from '@/lib/useDebounced';
import { fonts, radius, usePalette } from '@/theme';
import { reviewChanges } from './AdminConfigPage';

const HOOKS_KEY = ['admin', 'event-webhooks'];

/** MavieChat's push relay: Open WebUI's finished and failed chats reach phones through it. */
const isRelayHook = (url: string): boolean => url.trim().toLowerCase().startsWith(`${PUSH_RELAY_URL}/v1/events/`);

/** Whether the relay still hears about every finished and failed chat. */
function relayServed(events: string[], targets: EventWebhookTarget[] | null): boolean {
  if (targets !== null) return false;
  const covers = (event: string) => events.some((filter) => filter === '*' || filter === event || filter === 'chat.*');
  return covers('chat.finished') && covers('chat.failed');
}

const RELAY_WARNING = 'MavieChat’s notification service needs chat.finished and chat.failed for everyone: after this, phones signed in to this server may stop getting a notification when a reply finishes.';

/**
 * The server's event webhooks (the web's Admin → Settings → General → Events): each one's name,
 * host, events and whose, and a switch; add or edit in a sheet. The whole address is shown only
 * when asked, since it may carry a secret. The webhook of MavieChat's own notification service is
 * marked, and turning it off, deleting it or narrowing it asks first.
 */
export function EventWebhooks() {
  const palette = usePalette();
  const toast = useToast();
  const { client } = useAuthed();
  const queryClient = useQueryClient();
  const hooks = useQuery({ queryKey: HOOKS_KEY, queryFn: () => listEventWebhooks(client), staleTime: 0 });
  const kinds = useQuery({ queryKey: ['admin', 'event-kinds'], queryFn: () => listEventKinds(client), staleTime: 10 * 60_000 });
  const [editing, setEditing] = useState<EventWebhook | 'new' | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: HOOKS_KEY });

  const setEnabled = (hook: EventWebhook, on: boolean) => {
    const change = () => {
      queryClient.setQueryData<EventWebhook[]>(HOOKS_KEY, (list) => list?.map((item) => (item.id === hook.id ? { ...item, enabled: on } : item)));
      updateEventWebhook(client, hook.id, { enabled: on })
        .catch((error: unknown) => toast(`Couldn’t turn it ${on ? 'on' : 'off'}: ${describeError(error)}`, 'error'))
        .finally(() => void refresh());
    };
    if (!on && isRelayHook(hook.url)) {
      Alert.alert('Turn off MavieChat’s notifications?', 'Phones signed in to this server stop getting a notification when a reply finishes, until it’s on again.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Turn Off', style: 'destructive', onPress: change },
      ]);
      return;
    }
    change();
  };

  const list = hooks.data ?? [];
  return (
    <View style={styles.wrap}>
      <SectionTitle title="Event Webhooks" />
      <Group>
        {hooks.isPending ? (
          <View key="loading" style={styles.row}>
            <ActivityIndicator color={palette.textMuted} />
          </View>
        ) : hooks.error ? (
          <Pressable key="error" accessibilityRole="button" onPress={() => void hooks.refetch()} style={styles.row}>
            <Text style={[styles.hint, styles.grow, { color: palette.danger }]}>{`Couldn’t load them: ${describeError(hooks.error)}. Tap to try again.`}</Text>
          </Pressable>
        ) : (
          list.map((hook) => (
            <View key={hook.id} style={styles.row}>
              <Pressable accessibilityRole="button" accessibilityHint="Edits it" onPress={() => setEditing(hook)} style={styles.grow}>
                <Text style={[styles.label, { color: hook.enabled ? palette.text : palette.textMuted }]} numberOfLines={1}>
                  {webhookName(hook)}
                </Text>
                {isRelayHook(hook.url) ? <Text style={[styles.hint, { color: palette.textMuted }]}>MavieChat’s notification service</Text> : null}
                <Text style={[styles.hint, { color: palette.textMuted }]} numberOfLines={2}>
                  {[webhookHost(hook.url), eventsLine(hook.events), audienceLine(hook.targets)].join(' · ')}
                </Text>
              </Pressable>
              <Switch accessibilityLabel={`${webhookName(hook)} on`} value={hook.enabled} onValueChange={(on) => setEnabled(hook, on)} />
            </View>
          ))
        )}
        <ActionRow key="add" label="Add Webhook" onPress={() => setEditing('new')} />
      </Group>
      <Note>
        {list.length === 0 && hooks.data
          ? 'None. The server can post its events (chats finished, people signing up, settings changed and more) as JSON to an address; Slack, Discord, Google Chat and Teams get a readable message instead.'
          : 'The server posts the events each one matches as JSON; Slack, Discord, Google Chat and Teams get a readable message instead. Saved at once, for the whole server.'}
      </Note>
      <WebhookEditor hook={editing} kinds={kinds.data ?? []} onClose={() => setEditing(null)} onSaved={() => void refresh()} />
    </View>
  );
}

function WebhookEditor({ hook, kinds, onClose, onSaved }: { hook: EventWebhook | 'new' | null; kinds: EventKind[]; onClose: () => void; onSaved: () => void }) {
  return (
    <Modal visible={hook !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      {hook !== null ? <Editor key={hook === 'new' ? 'new' : hook.id} hook={hook} kinds={kinds} onClose={onClose} onSaved={onSaved} /> : null}
    </Modal>
  );
}

const AUDIENCES: { value: WebhookAudience; label: string; hint: string }[] = [
  { value: 'everyone', label: 'Everyone’s and the server’s', hint: 'Every matching event: anyone’s, and the server’s own, such as settings changes.' },
  { value: 'server', label: 'The server’s own only', hint: 'Only matching events that aren’t about a person, such as settings changes.' },
  { value: 'chosen', label: 'Chosen people and groups', hint: 'Only matching events about these people, or about people in these groups at the time. None of the server’s own.' },
];

/** At most this many events listed for what's typed. */
const LISTED = 40;

const sameEvents = (a: string[], b: string[]) => [...a].sort().join('\n') === [...b].sort().join('\n');
const targetKey = (targets: EventWebhookTarget[] | null) => (targets === null ? 'everyone' : targets.map((target) => `${target.type}:${target.id}`).sort().join(','));

function Editor({ hook, kinds, onClose, onSaved }: { hook: EventWebhook | 'new'; kinds: EventKind[]; onClose: () => void; onSaved: () => void }) {
  const palette = usePalette();
  const toast = useToast();
  const { client } = useAuthed();
  const existing = hook === 'new' ? null : hook;
  const relay = existing ? isRelayHook(existing.url) : false;
  const [name, setName] = useState(existing?.name ?? '');
  // An existing address stays as it is unless you change it; it's shown only when asked.
  const [url, setUrl] = useState('');
  const [changingUrl, setChangingUrl] = useState(existing === null);
  const [showUrl, setShowUrl] = useState(false);
  const [enabled, setEnabled] = useState(existing?.enabled ?? true);
  const [audience, setAudience] = useState<WebhookAudience>(existing ? audienceOf(existing.targets) : 'everyone');
  const [chosen, setChosen] = useState<EventWebhookTarget[]>(existing?.targets ?? []);
  const [allEvents, setAllEvents] = useState(!existing || existing.events.includes('*'));
  const [filters, setFilters] = useState<string[]>(existing && !existing.events.includes('*') ? existing.events : []);
  const [pattern, setPattern] = useState('');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const debounced = useDebounced(query.trim(), 300);
  const known = kinds.map((kind) => kind.event);

  const groups = useQuery({ queryKey: ['admin', 'groups-for-events'], queryFn: () => listAdminGroups(client), enabled: audience === 'chosen', staleTime: 60_000 });
  const found = useQuery({ queryKey: ['user-search', debounced], queryFn: () => searchUsers(client, debounced), enabled: audience === 'chosen' && debounced.length > 0 });
  const userIds = chosen.filter((target) => target.type === 'user').map((target) => target.id);
  const users = useQueries({ queries: userIds.map((id) => ({ queryKey: ['user-info', id], queryFn: () => getUserInfo(client, id), staleTime: 5 * 60_000 })) });
  const nameOf = (target: EventWebhookTarget) =>
    (target.type === 'group' ? groups.data?.find((group) => group.id === target.id)?.name : users[userIds.indexOf(target.id)]?.data?.name) || target.id;
  const isChosen = (type: 'user' | 'group', id: string) => chosen.some((target) => target.type === type && target.id === id);
  const choose = (target: EventWebhookTarget) => {
    if (!isChosen(target.type, target.id)) setChosen([...chosen, target]);
    setQuery('');
  };

  const events = allEvents ? ['*'] : filters;
  const targets: EventWebhookTarget[] | null = audience === 'everyone' ? null : audience === 'server' ? [] : chosen;
  const address = url.trim();
  const urlProblem = changingUrl && address && !/^https?:\/\/[^\s/]+/i.test(address) ? 'The address starts with https:// (or http://).' : null;
  const patternProblem = pattern.trim() ? eventFilterProblem(pattern, known) : null;
  const problem =
    (existing === null || changingUrl) && !address
      ? 'Add the address it posts to.'
      : urlProblem
        ? urlProblem
        : !allEvents && !filters.length
          ? 'Choose at least one event, or All events.'
          : audience === 'chosen' && !chosen.length
            ? 'Choose at least one person or group.'
            : null;
  const ready = !busy && !problem;
  const lookedFor = pattern.trim().toLowerCase().replace(/\*$/, '');
  // Typed: the matching events (a phone screen's worth). Not yet: each kind as a pattern to add.
  const matches = lookedFor ? kinds.filter((kind) => kind.event.includes(lookedFor) || kind.message.toLowerCase().includes(lookedFor)) : [];
  const listed = matches.slice(0, LISTED);
  const families = [...new Set(kinds.map((kind) => kind.event.split('.')[0] ?? ''))].filter(Boolean).map((family) => ({ family, count: kinds.filter((kind) => kind.event.startsWith(`${family}.`)).length }));

  const addPattern = () => {
    const filter = pattern.trim();
    if (!filter || patternProblem) return;
    if (filter === '*') setAllEvents(true);
    else setFilters([...new Set([...filters, filter])]);
    setPattern('');
  };
  const toggleEvent = (event: string) => setFilters(filters.includes(event) ? filters.filter((item) => item !== event) : [...filters, event].sort());

  const write = async (change: Partial<EventWebhookFields>) => {
    setBusy(true);
    try {
      if (existing) await updateEventWebhook(client, existing.id, change);
      else await createEventWebhook(client, { name, url: address, enabled, events, targets });
      onSaved();
      toast(existing ? 'Webhook saved' : 'Webhook added');
      onClose();
    } catch (error) {
      toast(`Couldn’t save it: ${describeError(error)}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  const save = () => {
    if (!ready) return;
    if (!existing) {
      const lines = [`Posts to ${webhookHost(address)}`, `Events: ${eventsLine(events)}`, `Whose: ${audienceLine(targets)}`, enabled ? 'On' : 'Off'];
      reviewChanges(`Add ${name.trim() || 'Webhook'}?`, lines, [], () => void write({}));
      return;
    }
    const change: Partial<EventWebhookFields> = {};
    const lines: string[] = [];
    if (name.trim() !== existing.name) {
      change.name = name;
      lines.push(`Name: ${webhookName(existing)} → ${name.trim() || webhookName({ id: existing.id, name: '' })}`);
    }
    if (changingUrl && address) {
      change.url = address;
      lines.push(`Address: changed, now at ${webhookHost(address)}`);
    }
    if (enabled !== existing.enabled) {
      change.enabled = enabled;
      lines.push(enabled ? 'Off → On' : 'On → Off');
    }
    if (!sameEvents(events, existing.events)) {
      change.events = events;
      lines.push(`Events: ${eventsLine(existing.events)} → ${eventsLine(events)}`);
    }
    if (targetKey(targets) !== targetKey(existing.targets)) {
      change.targets = targets;
      lines.push(`Whose: ${audienceLine(existing.targets)} → ${audienceLine(targets)}`);
    }
    if (!lines.length) {
      onClose();
      return;
    }
    const breaksRelay = relay && relayServed(existing.events, existing.targets) && (!enabled || !relayServed(events, targets) || (change.url !== undefined && !isRelayHook(change.url)));
    reviewChanges(`Save ${webhookName(existing)}?`, lines, breaksRelay ? [RELAY_WARNING] : [], () => void write(change));
  };

  const remove = (target: EventWebhook) =>
    Alert.alert(
      `Delete ${webhookName(target)}?`,
      [
        'It can’t be undone.',
        target.id === DEFAULT_EVENT_WEBHOOK_ID ? 'It also clears the single webhook address of earlier versions.' : '',
        isRelayHook(target.url) ? 'Phones signed in to this server stop getting a notification when a reply finishes.' : '',
      ]
        .filter(Boolean)
        .join(' '),
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            setBusy(true);
            deleteEventWebhook(client, target.id).then(
              () => {
                onSaved();
                toast('Webhook deleted');
                onClose();
              },
              (error: unknown) => {
                setBusy(false);
                toast(`Couldn’t delete it: ${describeError(error)}`, 'error');
              },
            );
          },
        },
      ],
    );

  const input = [styles.input, { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface }];
  return (
    <KeyboardAvoidingView behavior="padding" style={[styles.sheet, { backgroundColor: palette.background }]}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" onPress={onClose} hitSlop={10}>
          <Text style={[styles.action, { color: palette.link }]}>Cancel</Text>
        </Pressable>
        <Text style={[styles.title, { color: palette.text }]} accessibilityRole="header" numberOfLines={1}>
          {existing ? 'Edit Webhook' : 'Add Webhook'}
        </Text>
        {busy ? (
          <ActivityIndicator color={palette.textMuted} />
        ) : (
          <Pressable accessibilityRole="button" onPress={save} disabled={!ready} hitSlop={10}>
            <Text style={[styles.action, styles.strong, { color: ready ? palette.link : palette.textFaint }]}>{existing ? 'Save' : 'Add'}</Text>
          </Pressable>
        )}
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {relay ? <Text style={[styles.fieldHint, { color: palette.textMuted }]}>{`MavieChat’s notification service. It needs chat.finished and chat.failed (or All events), for everyone, to notify phones.`}</Text> : null}

        <Text style={[styles.fieldLabel, { color: palette.textMuted }]}>Name</Text>
        <TextInput value={name} onChangeText={setName} placeholder={existing?.id === DEFAULT_EVENT_WEBHOOK_ID ? 'Default webhook' : 'Webhook'} placeholderTextColor={palette.textFaint} accessibilityLabel="Name" style={input} />

        <Text style={[styles.fieldLabel, { color: palette.textMuted }]}>Address</Text>
        {existing && !changingUrl ? (
          <View style={[styles.addressBox, { borderColor: palette.border, backgroundColor: palette.surface }]}>
            <Text selectable={showUrl} style={[styles.address, { color: palette.text }]} numberOfLines={showUrl ? undefined : 1}>
              {showUrl ? existing.url || 'No address' : `${webhookHost(existing.url)}/…`}
            </Text>
            <View style={styles.addressActions}>
              <Pressable accessibilityRole="button" onPress={() => setShowUrl(!showUrl)} hitSlop={8}>
                <Text style={[styles.link, { color: palette.link }]}>{showUrl ? 'Hide' : 'Show'}</Text>
              </Pressable>
              <Pressable accessibilityRole="button" onPress={() => setChangingUrl(true)} hitSlop={8}>
                <Text style={[styles.link, { color: palette.link }]}>Change</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <>
            <TextInput
              value={url}
              onChangeText={setUrl}
              placeholder="https://example.com/events"
              placeholderTextColor={palette.textFaint}
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus={existing === null}
              keyboardType="url"
              textContentType="URL"
              accessibilityLabel="Address"
              style={[input, urlProblem ? { borderColor: palette.danger } : null]}
            />
            {existing ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setChangingUrl(false);
                  setUrl('');
                }}
                hitSlop={8}>
                <Text style={[styles.link, { color: palette.link }]}>Keep the current address</Text>
              </Pressable>
            ) : null}
          </>
        )}
        <Text style={[styles.fieldHint, { color: urlProblem ? palette.danger : palette.textFaint }]}>
          {urlProblem ?? 'Shown in full only when you ask: webhook addresses often carry a secret. The server checks it can reach it.'}
        </Text>

        <View style={[styles.switchRow, { borderColor: palette.border }]}>
          <Text style={[styles.label, styles.grow, { color: palette.text }]}>On</Text>
          <Switch accessibilityLabel="On" value={enabled} onValueChange={setEnabled} />
        </View>

        <Text style={[styles.fieldLabel, { color: palette.textMuted }]}>Whose events</Text>
        <View style={[styles.group, { borderColor: palette.border }]}>
          {AUDIENCES.map((option, index) => {
            const selected = option.value === audience;
            return (
              <Pressable
                key={option.value}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                onPress={() => setAudience(option.value)}
                style={({ pressed }) => [styles.choice, index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.border }, pressed && { backgroundColor: palette.surface }]}>
                <View style={styles.grow}>
                  <Text style={[styles.label, { color: palette.text }]}>{option.label}</Text>
                  {selected ? <Text style={[styles.hint, { color: palette.textMuted }]}>{option.hint}</Text> : null}
                </View>
                {selected ? <Icon name="check" size={18} color={palette.text} strokeWidth={2} /> : null}
              </Pressable>
            );
          })}
        </View>
        {audience === 'chosen' ? (
          <View style={styles.chosen}>
            {chosen.length ? (
              <View style={styles.chips}>
                {chosen.map((target) => (
                  <View key={`${target.type}:${target.id}`} style={[styles.chip, { borderColor: palette.border }]}>
                    <Icon name={target.type === 'group' ? 'user-group' : 'user-circle'} size={14} color={palette.textMuted} />
                    <Text style={[styles.chipText, { color: palette.text }]} numberOfLines={1}>
                      {nameOf(target)}
                    </Text>
                    <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${nameOf(target)}`} onPress={() => setChosen(chosen.filter((item) => item !== target))} hitSlop={8}>
                      <Icon name="x-mark" size={14} color={palette.textMuted} />
                    </Pressable>
                  </View>
                ))}
              </View>
            ) : null}
            <TextInput value={query} onChangeText={setQuery} placeholder="Find a person or a group" placeholderTextColor={palette.textFaint} autoCapitalize="none" autoCorrect={false} clearButtonMode="while-editing" accessibilityLabel="Find a person or a group" style={input} />
            {query.trim()
              ? [
                  ...(groups.data ?? [])
                    .filter((group) => group.name.toLowerCase().includes(query.trim().toLowerCase()) && !isChosen('group', group.id))
                    .slice(0, 5)
                    .map((group) => ({ type: 'group' as const, id: group.id, name: group.name, detail: 'Group' })),
                  ...(found.data ?? [])
                    .filter((user) => !isChosen('user', user.id))
                    .slice(0, 5)
                    .map((user) => ({ type: 'user' as const, id: user.id, name: user.name, detail: user.email })),
                ].map((item) => (
                  <Pressable
                    key={`${item.type}:${item.id}`}
                    accessibilityRole="button"
                    onPress={() => choose({ type: item.type, id: item.id })}
                    style={({ pressed }) => [styles.pick, pressed && { backgroundColor: palette.surface }]}>
                    <Icon name={item.type === 'group' ? 'user-group' : 'user-circle'} size={16} color={palette.textMuted} />
                    <View style={styles.grow}>
                      <Text style={[styles.label, { color: palette.text }]} numberOfLines={1}>
                        {item.name}
                      </Text>
                      {item.detail ? (
                        <Text style={[styles.hint, { color: palette.textMuted }]} numberOfLines={1}>
                          {item.detail}
                        </Text>
                      ) : null}
                    </View>
                    <Icon name="plus" size={16} color={palette.link} />
                  </Pressable>
                ))
              : null}
          </View>
        ) : null}

        <View style={[styles.switchRow, styles.spaced, { borderColor: palette.border }]}>
          <Text style={[styles.label, styles.grow, { color: palette.text }]}>All events</Text>
          <Switch accessibilityLabel="All events" value={allEvents} onValueChange={setAllEvents} />
        </View>
        {!allEvents ? (
          <>
            {filters.length ? (
              <View style={styles.chips}>
                {filters.map((filter) => (
                  <View key={filter} style={[styles.chip, { borderColor: palette.border }]}>
                    <Text style={[styles.chipText, styles.mono, { color: palette.text }]} numberOfLines={1}>
                      {filter}
                    </Text>
                    <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${filter}`} onPress={() => setFilters(filters.filter((item) => item !== filter))} hitSlop={8}>
                      <Icon name="x-mark" size={14} color={palette.textMuted} />
                    </Pressable>
                  </View>
                ))}
              </View>
            ) : null}
            <View style={styles.patternRow}>
              <TextInput
                value={pattern}
                onChangeText={setPattern}
                onSubmitEditing={addPattern}
                placeholder="Find an event, or add a pattern like user.*"
                placeholderTextColor={palette.textFaint}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="done"
                accessibilityLabel="Find an event or add a pattern"
                style={[input, styles.grow, styles.mono]}
              />
              <Pressable accessibilityRole="button" accessibilityState={{ disabled: !pattern.trim() || Boolean(patternProblem) }} disabled={!pattern.trim() || Boolean(patternProblem)} onPress={addPattern} hitSlop={8}>
                <Text style={[styles.link, { color: pattern.trim() && !patternProblem ? palette.link : palette.textFaint }]}>Add</Text>
              </Pressable>
            </View>
            <Text style={[styles.fieldHint, { color: patternProblem ? palette.danger : palette.textFaint }]}>
              {patternProblem ?? 'Event names can change as Open WebUI updates; a pattern such as user.* keeps catching new events of that kind.'}
            </Text>
            {!lookedFor ? (
              <>
                <Text style={[styles.fieldHint, { color: palette.textMuted }]}>Each kind of event, as a pattern; or type to find one by name.</Text>
                <View style={styles.chips}>
                  {families.map(({ family, count }) => {
                    const added = filters.includes(`${family}.*`);
                    return (
                      <Pressable
                        key={family}
                        accessibilityRole="button"
                        accessibilityState={{ disabled: added }}
                        accessibilityLabel={`Add ${family}.*, ${count} events`}
                        disabled={added}
                        onPress={() => setFilters([...filters, `${family}.*`].sort())}
                        style={[styles.chip, { borderColor: palette.border, opacity: added ? 0.45 : 1 }]}>
                        <Text style={[styles.chipText, styles.mono, { color: palette.text }]}>{`${family}.*`}</Text>
                        <Text style={[styles.hint, { color: palette.textMuted }]}>{count}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </>
            ) : null}
            {lookedFor ? (
              <View style={[styles.group, { borderColor: palette.border }]}>
                {listed.map((kind, index) => {
                  const on = filters.includes(kind.event);
                  return (
                    <Pressable
                      key={kind.event}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: on }}
                      onPress={() => toggleEvent(kind.event)}
                      style={({ pressed }) => [styles.choice, index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.border }, pressed && { backgroundColor: palette.surface }]}>
                      <View style={styles.grow}>
                        <Text style={[styles.eventName, { color: palette.text }]}>{kind.event}</Text>
                        {kind.message ? <Text style={[styles.hint, { color: palette.textMuted }]}>{kind.message}</Text> : null}
                      </View>
                      {on ? <Icon name="check" size={18} color={palette.text} strokeWidth={2} /> : null}
                    </Pressable>
                  );
                })}
                {!listed.length ? <Text style={[styles.hint, styles.empty, { color: palette.textMuted }]}>No event matches.</Text> : null}
                {matches.length > listed.length ? (
                  <Text style={[styles.hint, styles.empty, { color: palette.textMuted }]}>{`${matches.length - listed.length} more: type more to narrow it down.`}</Text>
                ) : null}
              </View>
            ) : null}
          </>
        ) : null}

        {problem && !urlProblem ? <Text style={[styles.fieldHint, styles.spaced, { color: palette.textMuted }]}>{problem}</Text> : null}
        {existing ? (
          <Pressable accessibilityRole="button" onPress={() => remove(existing)} disabled={busy} style={styles.delete}>
            <Text style={[styles.deleteText, { color: palette.danger }]}>Delete Webhook</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 46, paddingLeft: 14, paddingRight: 10, paddingVertical: 10 },
  grow: { flex: 1, gap: 2 },
  label: { fontFamily: fonts.regular, fontSize: 15 },
  hint: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
  sheet: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
  title: { flex: 1, textAlign: 'center', fontFamily: fonts.semibold, fontSize: 17 },
  action: { fontFamily: fonts.regular, fontSize: 16 },
  strong: { fontFamily: fonts.semibold },
  content: { padding: 16, gap: 8, paddingBottom: 48 },
  fieldLabel: { fontFamily: fonts.medium, fontSize: 13, marginTop: 8, marginLeft: 4 },
  fieldHint: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16, marginHorizontal: 4 },
  input: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10, fontFamily: fonts.regular, fontSize: 15 },
  mono: { fontFamily: fonts.mono, fontSize: 13 },
  addressBox: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10, gap: 8 },
  address: { fontFamily: fonts.mono, fontSize: 13 },
  addressActions: { flexDirection: 'row', gap: 18 },
  link: { fontFamily: fonts.medium, fontSize: 14 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 46, paddingHorizontal: 14, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg, marginTop: 8 },
  spaced: { marginTop: 12 },
  group: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg, overflow: 'hidden' },
  choice: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 46, paddingHorizontal: 14, paddingVertical: 10 },
  chosen: { gap: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.full, paddingHorizontal: 10, paddingVertical: 5, maxWidth: '100%' },
  chipText: { fontFamily: fonts.regular, fontSize: 13, flexShrink: 1 },
  pick: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 6, paddingVertical: 8, borderRadius: radius.md },
  patternRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  eventName: { fontFamily: fonts.mono, fontSize: 13 },
  empty: { padding: 14 },
  delete: { alignSelf: 'center', marginTop: 24, padding: 8 },
  deleteText: { fontFamily: fonts.medium, fontSize: 15 },
});
