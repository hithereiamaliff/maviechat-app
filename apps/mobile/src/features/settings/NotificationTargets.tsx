import {
  createNotificationTarget,
  deleteNotificationTarget,
  FALLBACK_NOTIFICATION_EVENTS,
  listNotificationEvents,
  listNotificationTargets,
  maskedTargetUrl,
  setDefaultNotificationTarget,
  targetEventsLine,
  testNotificationTarget,
  updateNotificationTarget,
  type NotificationEvent,
  type NotificationTarget,
} from '@maviechat/owui-protocol';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { Icon } from '@/components/Icon';
import { MenuButton, type MenuItem } from '@/components/Menu';
import { Modal } from '@/components/Modal';
import { useToast } from '@/components/Toast';
import { describeError } from '@/lib/errors';
import { useAuthed } from '@/lib/server';
import { fonts, radius, usePalette } from '@/theme';
import { ActionRow, Group, Note, SectionTitle } from './rows';

const TARGETS_KEY = ['notification-targets'];

/**
 * Your notification targets (the web's Notifications tab): webhooks your Open WebUI server posts
 * to when a chat finishes or fails, as you choose, and that the notify tool can send to. Shown
 * where the admin lets people add webhooks and your account may.
 */
export function NotificationTargets() {
  const palette = usePalette();
  const toast = useToast();
  const { client } = useAuthed();
  const queryClient = useQueryClient();
  const targets = useQuery({ queryKey: TARGETS_KEY, queryFn: () => listNotificationTargets(client) });
  const events = useQuery({ queryKey: ['notification-events'], queryFn: () => listNotificationEvents(client), staleTime: 10 * 60_000 });
  const catalog = events.data ?? FALLBACK_NOTIFICATION_EVENTS;
  const [editing, setEditing] = useState<NotificationTarget | 'new' | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: TARGETS_KEY });

  const run = async (failure: string, action: () => Promise<unknown>, success?: string) => {
    try {
      await action();
      if (success) toast(success);
    } catch (error) {
      toast(`${failure}: ${describeError(error)}`, 'error');
    } finally {
      void refresh();
    }
  };

  const setEnabled = (target: NotificationTarget, on: boolean) => {
    queryClient.setQueryData<NotificationTarget[]>(TARGETS_KEY, (list) => list?.map((item) => (item.id === target.id ? { ...item, enabled: on } : item)));
    void run(`Couldn’t turn ${target.id} ${on ? 'on' : 'off'}`, () => updateNotificationTarget(client, target.id, { enabled: on }));
  };

  const remove = (target: NotificationTarget) =>
    Alert.alert(`Remove ${target.id}?`, 'Your server stops posting to it.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => void run('Couldn’t remove it', () => deleteNotificationTarget(client, target.id), `${target.id} removed`) },
    ]);

  const menuFor = (target: NotificationTarget): MenuItem[] => [
    { key: 'test', label: 'Send Test', icon: 'paper-airplane', onPress: () => void run('Couldn’t send the test', () => testNotificationTarget(client, target.id), `Test sent to ${target.id}`) },
    ...(target.is_default
      ? []
      : [{ key: 'default', label: 'Make Default', icon: 'star' as const, onPress: () => void run('Couldn’t make it the default', () => setDefaultNotificationTarget(client, target.id)) }]),
    { key: 'edit', label: 'Edit…', icon: 'pencil', onPress: () => setEditing(target) },
    { key: 'remove', label: 'Remove', icon: 'trash', destructive: true, onPress: () => remove(target) },
  ];

  const list = targets.data ?? [];
  return (
    <View style={styles.wrap}>
      <SectionTitle title="Notification Targets" />
      <Group>
        {targets.isPending ? (
          <View key="loading" style={styles.row}>
            <ActivityIndicator color={palette.textMuted} />
          </View>
        ) : targets.error ? (
          <Pressable key="error" accessibilityRole="button" onPress={() => void targets.refetch()} style={styles.row}>
            <Text style={[styles.hint, styles.grow, { color: palette.danger }]}>{`Couldn’t load them: ${describeError(targets.error)}. Tap to try again.`}</Text>
          </Pressable>
        ) : (
          list.map((target) => (
            <View key={target.id} style={styles.row}>
              <Pressable accessibilityRole="button" accessibilityHint="Edits it" onPress={() => setEditing(target)} style={styles.grow}>
                <View style={styles.titleLine}>
                  <Text style={[styles.label, { color: target.enabled ? palette.text : palette.textMuted }]} numberOfLines={1}>
                    {target.id}
                  </Text>
                  {target.is_default ? <Text style={[styles.badge, { color: palette.textMuted, borderColor: palette.border }]}>Default</Text> : null}
                </View>
                <Text style={[styles.hint, { color: palette.textMuted }]} numberOfLines={1}>
                  {maskedTargetUrl(target) || 'Webhook'}
                </Text>
                <Text style={[styles.hint, { color: palette.textMuted }]} numberOfLines={2}>
                  {targetEventsLine(target, catalog)}
                </Text>
              </Pressable>
              <MenuButton items={menuFor(target)} label={`Options for ${target.id}`} size={18} color={palette.textMuted} />
              <Switch accessibilityLabel={`${target.id} on`} value={target.enabled} onValueChange={(on) => setEnabled(target, on)} />
            </View>
          ))
        )}
        <ActionRow key="add" label="Add Notification Target" onPress={() => setEditing('new')} />
      </Group>
      <Note>
        {list.length === 0 && !targets.isPending && !targets.error
          ? 'None yet. A target is a webhook address (Slack, Google Chat, Discord, Teams or your own) that your Open WebUI server posts to when a chat finishes or fails, as you choose.'
          : 'Your Open WebUI server posts to each target that’s on, for the events you chose; for a finished chat, its title, the whole reply and a link. The notify tool can send to any target that’s on, events or not; the default is the one it uses when it names none.'}
      </Note>
      <TargetEditor target={editing} events={catalog} onClose={() => setEditing(null)} onSaved={() => void refresh()} />
    </View>
  );
}

/** Adds a target (`'new'`) or edits one, in a sheet: its address, its name, its events and when they go. */
function TargetEditor({ target, events, onClose, onSaved }: { target: NotificationTarget | 'new' | null; events: NotificationEvent[]; onClose: () => void; onSaved: () => void }) {
  return (
    <Modal visible={target !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      {target !== null ? <Editor key={target === 'new' ? 'new' : target.id} target={target} events={events} onClose={onClose} onSaved={onSaved} /> : null}
    </Modal>
  );
}

const DELIVERY = [
  { value: 'away', label: 'Only when away', hint: 'Only while you haven’t used Open WebUI for 3 minutes.' },
  { value: 'always', label: 'Always', hint: 'Every time, even while you’re using it.' },
] as const;

function Editor({ target, events, onClose, onSaved }: { target: NotificationTarget | 'new'; events: NotificationEvent[]; onClose: () => void; onSaved: () => void }) {
  const palette = usePalette();
  const toast = useToast();
  const { client } = useAuthed();
  const existing = target === 'new' ? null : target;
  const [url, setUrl] = useState('');
  const [name, setName] = useState(existing?.id ?? '');
  const [chosen, setChosen] = useState<string[]>(existing?.events ?? []);
  const [delivery, setDelivery] = useState<'away' | 'always'>(existing?.delivery === 'always' ? 'always' : 'away');
  const [busy, setBusy] = useState(false);
  const address = url.trim();
  const urlProblem = address && !/^https?:\/\/[^\s/]+/i.test(address) ? 'The address starts with https:// (or http://).' : null;
  const ready = !busy && !urlProblem && (existing !== null || address.length > 0);
  // Events the target has that the server no longer lists stay, so saving doesn't drop them unseen.
  const offered = [...events, ...chosen.filter((event) => !events.some((item) => item.event === event)).map((event) => ({ event, label: event, description: '' }))];
  const masked = existing ? maskedTargetUrl(existing) : '';

  const toggle = (event: string) => setChosen((current) => (current.includes(event) ? current.filter((item) => item !== event) : [...current, event]));

  const save = async () => {
    if (!ready) return;
    setBusy(true);
    try {
      const change = { id: name, events: chosen, delivery, url: address };
      if (existing) await updateNotificationTarget(client, existing.id, change);
      else await createNotificationTarget(client, change);
      onSaved();
      toast(existing ? 'Target saved' : 'Target added');
      onClose();
    } catch (error) {
      toast(`Couldn’t save it: ${describeError(error)}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior="padding" style={[styles.sheet, { backgroundColor: palette.background }]}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" onPress={onClose} hitSlop={10}>
          <Text style={[styles.action, { color: palette.link }]}>Cancel</Text>
        </Pressable>
        <Text style={[styles.title, { color: palette.text }]} accessibilityRole="header" numberOfLines={1}>
          {existing ? 'Edit Target' : 'Add Target'}
        </Text>
        {busy ? (
          <ActivityIndicator color={palette.textMuted} />
        ) : (
          <Pressable accessibilityRole="button" onPress={() => void save()} disabled={!ready} hitSlop={10}>
            <Text style={[styles.action, styles.strong, { color: ready ? palette.link : palette.textFaint }]}>{existing ? 'Save' : 'Add'}</Text>
          </Pressable>
        )}
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={[styles.fieldLabel, { color: palette.textMuted }]}>Webhook address</Text>
        <TextInput
          value={url}
          onChangeText={setUrl}
          placeholder={existing ? 'Leave empty to keep the current one' : 'https://hooks.example.com/…'}
          placeholderTextColor={palette.textFaint}
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus={!existing}
          keyboardType="url"
          textContentType="URL"
          accessibilityLabel="Webhook address"
          style={[styles.input, { color: palette.text, borderColor: urlProblem ? palette.danger : palette.border, backgroundColor: palette.surface }]}
        />
        <Text style={[styles.fieldHint, { color: urlProblem ? palette.danger : palette.textFaint }]}>
          {urlProblem ?? (masked ? `Now ${masked}. The server never shows the whole address again.` : 'Slack, Google Chat, Discord and Teams get their own message format; other addresses get the event as JSON.')}
        </Text>

        <Text style={[styles.fieldLabel, { color: palette.textMuted }]}>Name</Text>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder={existing ? existing.id : 'Made from the address if left empty'}
          placeholderTextColor={palette.textFaint}
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel="Name"
          style={[styles.input, styles.mono, { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface }]}
        />
        <Text style={[styles.fieldHint, { color: palette.textFaint }]}>The notify tool can send to a target by its name.</Text>

        <Text style={[styles.fieldLabel, { color: palette.textMuted }]}>Automatic events</Text>
        <View style={[styles.group, { borderColor: palette.border }]}>
          {offered.map((event, index) => {
            const on = chosen.includes(event.event);
            return (
              <Pressable
                key={event.event}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                onPress={() => toggle(event.event)}
                style={({ pressed }) => [styles.choice, index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.border }, pressed && { backgroundColor: palette.surface }]}>
                <View style={styles.grow}>
                  <Text style={[styles.label, { color: palette.text }]}>{event.label}</Text>
                  {event.description ? <Text style={[styles.hint, { color: palette.textMuted }]}>{event.description}</Text> : null}
                </View>
                {on ? <Icon name="check" size={18} color={palette.text} strokeWidth={2} /> : null}
              </Pressable>
            );
          })}
        </View>

        {chosen.length ? (
          <>
            <Text style={[styles.fieldLabel, { color: palette.textMuted }]}>Automatic delivery</Text>
            <View style={[styles.segments, { backgroundColor: palette.surfaceStrong }]} accessibilityRole="radiogroup">
              {DELIVERY.map((option) => {
                const selected = option.value === delivery;
                return (
                  <Pressable
                    key={option.value}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    onPress={() => setDelivery(option.value)}
                    style={[styles.segment, selected && { backgroundColor: palette.background }]}>
                    <Text style={[styles.segmentText, { color: selected ? palette.text : palette.textMuted }]}>{option.label}</Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={[styles.fieldHint, { color: palette.textFaint }]}>{DELIVERY.find((option) => option.value === delivery)?.hint}</Text>
          </>
        ) : null}

        <Text style={[styles.fieldHint, styles.footer, { color: palette.textFaint }]}>
          The notify tool can send to a target that’s on, whatever its events.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 46, paddingLeft: 14, paddingRight: 10, paddingVertical: 10 },
  grow: { flex: 1, gap: 2 },
  titleLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  label: { flexShrink: 1, fontFamily: fonts.regular, fontSize: 15 },
  badge: { fontFamily: fonts.medium, fontSize: 11, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.sm, paddingHorizontal: 5, paddingVertical: 1, overflow: 'hidden' },
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
  mono: { fontFamily: fonts.mono, fontSize: 14 },
  group: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg, overflow: 'hidden' },
  choice: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 46, paddingHorizontal: 14, paddingVertical: 10 },
  segments: { flexDirection: 'row', padding: 2, borderRadius: radius.md },
  segment: { flex: 1, alignItems: 'center', paddingVertical: 7, borderRadius: radius.md - 2 },
  segmentText: { fontFamily: fonts.medium, fontSize: 14 },
  footer: { marginTop: 16 },
});
