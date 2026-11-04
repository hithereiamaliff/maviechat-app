import { DtHttpError, memoryDocLabel, memoryRunActive, memoryRunModes, resetMemoryDoc, resolveMemoryFact, type DtMemoryEntry, type DtMemoryLayer, type DtMemoryRunMode } from '@maviechat/deeptutor-protocol';
import { router, useLocalSearchParams } from 'expo-router';
import { useRef, useState, type ComponentRef } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View, type HostInstance } from 'react-native';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import type { MenuItem } from '@/components/Menu';
import { useToast } from '@/components/Toast';
import { DtHeader } from '@/features/deeptutor/DtHeader';
import { FactSheet } from '@/features/deeptutor/memory/FactSheet';
import { useMemoryRefresh, useMemoryRun, useMemoryRunLimits, useMemorySheet } from '@/features/deeptutor/memory/queries';
import type { SourceTarget } from '@/features/deeptutor/memory/sources';
import { describeError } from '@/lib/errors';
import { useDtAuthed } from '@/session/DeepTutorProvider';
import { fonts, radius, usePalette } from '@/theme';

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? (value[0] ?? '') : (value ?? ''));

const RUNS: Record<Exclude<DtMemoryRunMode, 'merge'>, { label: string; icon: 'arrow-path' | 'shield-check' | 'squares-2x2'; doing: string }> = {
  update: { label: 'Update with the Model', icon: 'arrow-path', doing: 'Gathering new facts' },
  audit: { label: 'Check Against Sources', icon: 'shield-check', doing: 'Checking facts against their sources' },
  dedup: { label: 'Merge Repeats', icon: 'squares-2x2', doing: 'Merging facts that say the same thing' },
};

/**
 * One memory sheet: its facts by section, each with where it came from; reword or delete one;
 * ask the model to update it, check it against its sources, or merge repeats (a run carries on if
 * you leave, and can be stopped and undone); or empty it.
 */
export default function MemorySheet() {
  const palette = usePalette();
  const toast = useToast();
  const { client } = useDtAuthed();
  const params = useLocalSearchParams<{ layer: string; key: string; focus?: string }>();
  const layer: DtMemoryLayer = one(params.layer) === 'L3' ? 'L3' : 'L2';
  const key = one(params.key);
  const focus = one(params.focus);
  const label = memoryDocLabel(layer, key);
  const sheet = useMemorySheet(layer, key);
  const limits = useMemoryRunLimits();
  const refresh = useMemoryRefresh();
  const { run, lost, start, cancel, undo, dismiss } = useMemoryRun(layer, key);
  const [picked, setPicked] = useState<DtMemoryEntry | null>(null);
  const [factOpen, setFactOpen] = useState(false);
  const pending = useRef<SourceTarget>(null);
  const scroller = useRef<ComponentRef<typeof ScrollView>>(null);
  const body = useRef<HostInstance>(null);
  const focusedRow = useRef<HostInstance>(null);
  const scrolled = useRef(false);
  const facts = sheet.data?.sections.reduce((sum, section) => sum + section.entries.length, 0) ?? 0;
  const busy = run ? memoryRunActive(run) : false;

  const go = async (target: SourceTarget) => {
    if (!target) return;
    if ('route' in target) return router.push(target.route);
    if ('web' in target) return router.push({ pathname: '/learn/web', params: { path: target.web, title: target.title } });
    try {
      const at = await resolveMemoryFact(client, target.fact);
      router.push({ pathname: '/learn/memory/sheet', params: { layer: at.layer, key: at.key, focus: at.id } });
    } catch (error) {
      toast(error instanceof DtHttpError && error.status === 404 ? 'That fact is gone: it may have been deleted or merged.' : `Couldn’t find it: ${describeError(error)}`, 'error');
    }
  };
  const begin = (mode: Exclude<DtMemoryRunMode, 'merge'>) => {
    const size = mode === 'dedup' ? { iterations: limits.data?.dedupIterations } : { budget: limits.data?.[mode][layer] };
    const most = mode === 'dedup' ? (size.iterations ? `up to ${size.iterations} passes` : 'a few passes') : size.budget ? `up to ${size.budget} model calls` : 'several model calls';
    const what =
      mode === 'update'
        ? layer === 'L2'
          ? `The model reads what’s new in your ${label.toLowerCase()} and adds facts, each citing its source`
          : 'The model draws the big picture from what’s new on your fact sheets'
        : mode === 'audit'
          ? 'The model checks each fact against its sources and corrects or removes what doesn’t hold'
          : 'The model merges facts that say the same thing';
    Alert.alert(`${RUNS[mode].label}?`, `${what}: ${most}, on your default model. It carries on if you leave, and you can undo it.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Start',
        onPress: () =>
          void start(mode, size).catch((error: unknown) =>
            toast(error instanceof DtHttpError && error.status === 409 ? 'A run on this sheet is going already (perhaps another account’s). Try again later.' : `Couldn’t start it: ${describeError(error)}`, 'error'),
          ),
      },
    ]);
  };
  const reset = () =>
    Alert.alert(`Empty ${label}?`, 'Its facts are deleted and it forgets what it has read, so its next update reads everything again.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Empty',
        style: 'destructive',
        onPress: () =>
          void resetMemoryDoc(client, layer, key).then(
            () => {
              refresh();
              toast(`${label} emptied`);
            },
            (error: unknown) => toast(error instanceof DtHttpError && error.status === 409 ? 'A run on this sheet is going: try when it’s done.' : `Couldn’t empty it: ${describeError(error)}`, 'error'),
          ),
      },
    ]);
  const undoRun = () =>
    void undo().then(
      () => toast('Undone'),
      (error: unknown) => toast(error instanceof DtHttpError && error.status === 409 ? 'Nothing left to undo.' : `Couldn’t undo it: ${describeError(error)}`, 'error'),
    );

  const menu: MenuItem[] = [
    ...memoryRunModes(layer, key).flatMap((mode) => (mode === 'merge' ? [] : [{ key: mode, label: RUNS[mode].label, icon: RUNS[mode].icon, onPress: () => (busy ? toast('A run is going on this sheet.') : begin(mode)) }])),
    { key: 'reset', label: 'Empty This Sheet', icon: 'trash', destructive: true, onPress: reset },
    { key: 'web', label: 'Open on the Web', icon: 'globe-alt', onPress: () => router.push({ pathname: '/learn/web', params: { path: `/memory/${layer.toLowerCase()}/${key}`, title: 'Memory' } }) },
  ];
  const empty =
    layer === 'L3' && key === 'preferences'
      ? 'No preferences saved. When you tell a chat how you like things, it saves them here.'
      : layer === 'L2'
        ? `No facts yet. Update with the model (menu) to gather them from your ${label.toLowerCase()}.`
        : 'Nothing yet. Update with the model (menu) to draw it from your fact sheets.';

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      <DtHeader title={label} menu={menu} />
      <ScrollView ref={scroller} refreshControl={<RefreshControl refreshing={false} onRefresh={refresh} />}>
        <View ref={body} style={styles.content}>
          {run || lost ? (
            <View style={[styles.run, { borderColor: palette.border, backgroundColor: palette.surface }]}>
              <View style={styles.runLine}>
                {busy ? <ActivityIndicator size="small" color={palette.textMuted} /> : <Icon name={run?.status === 'done' ? 'check' : 'exclamation-triangle'} size={16} color={palette.textMuted} />}
                <Text style={[styles.runText, { color: palette.text }]}>
                  {lost
                    ? 'Lost track of the run (DeepTutor may have restarted).'
                    : busy && run
                      ? `${RUNS[run.mode as keyof typeof RUNS]?.doing ?? 'Working'}… ${run.events} steps`
                      : run?.status === 'done'
                        ? `Done: ${facts} ${facts === 1 ? 'fact' : 'facts'} now.`
                        : run?.status === 'cancelled'
                          ? 'Stopped.'
                          : `It stopped: ${run?.error || 'an error'}`}
                </Text>
                {!busy ? (
                  <Pressable accessibilityRole="button" accessibilityLabel="Dismiss" onPress={dismiss} hitSlop={8}>
                    <Icon name="x-mark" size={16} color={palette.textMuted} />
                  </Pressable>
                ) : null}
              </View>
              {busy ? <Text style={[styles.runNote, { color: palette.textMuted }]}>It carries on if you leave.</Text> : null}
              {busy ? <Button label="Stop" variant="secondary" onPress={() => void cancel().catch((error: unknown) => toast(`Couldn’t stop it: ${describeError(error)}`, 'error'))} /> : null}
              {run && !busy && run.status !== 'error' ? <Button label="Undo" variant="secondary" onPress={undoRun} /> : null}
            </View>
          ) : null}
          {sheet.isLoading ? <ActivityIndicator color={palette.textMuted} /> : null}
          {sheet.isError ? <Text style={[styles.empty, { color: palette.textMuted }]}>{`Couldn’t open it: ${describeError(sheet.error)}`}</Text> : null}
          {sheet.data && !facts ? <Text style={[styles.empty, { color: palette.textMuted }]}>{empty}</Text> : null}
          {sheet.data?.sections.map((section) => (
            <View key={section.name || 'facts'} style={styles.block}>
              {section.name ? <Text style={[styles.section, { color: palette.textMuted }]}>{section.name}</Text> : null}
              <View style={[styles.group, { borderColor: palette.border }]}>
                {section.entries.map((entry, index) => {
                  const focused = Boolean(focus) && entry.id === focus;
                  return (
                    <Pressable
                      key={entry.id || `${index}-${entry.text}`}
                      accessibilityRole="button"
                      accessibilityHint="Shows where it came from"
                      onPress={() => {
                        setPicked(entry);
                        setFactOpen(true);
                      }}
                      ref={focused ? focusedRow : undefined}
                      onLayout={
                        focused
                          ? () => {
                              if (scrolled.current || !body.current) return;
                              scrolled.current = true;
                              focusedRow.current?.measureLayout(body.current, (_x, y) => scroller.current?.scrollTo({ y: Math.max(0, y - 40), animated: true }));
                            }
                          : undefined
                      }
                      style={({ pressed }) => [styles.fact, index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.border }, (pressed || focused) && { backgroundColor: palette.surface }]}>
                      <Text style={[styles.factText, { color: palette.text }]}>{entry.text}</Text>
                      {entry.refs.length ? <Text style={[styles.refs, { color: palette.textMuted }]}>{entry.refs.length === 1 ? '1 source' : `${entry.refs.length} sources`}</Text> : null}
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ))}
        </View>
      </ScrollView>
      <FactSheet
        visible={factOpen}
        layer={layer}
        sheetKey={key}
        entry={picked}
        onClose={() => setFactOpen(false)}
        onPick={(target) => {
          pending.current = target;
          setFactOpen(false);
        }}
        onDismiss={() => {
          const target = pending.current;
          pending.current = null;
          if (target) void go(target);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 16, gap: 12, paddingBottom: 48 },
  empty: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, textAlign: 'center', marginTop: 24, paddingHorizontal: 12 },
  run: { gap: 8, padding: 12, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md },
  runLine: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  runText: { flex: 1, fontFamily: fonts.medium, fontSize: 14 },
  runNote: { fontFamily: fonts.regular, fontSize: 12 },
  block: { gap: 6 },
  section: { fontFamily: fonts.medium, fontSize: 13, marginLeft: 4 },
  group: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg, overflow: 'hidden' },
  fact: { gap: 3, paddingHorizontal: 14, paddingVertical: 11 },
  factText: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 21 },
  refs: { fontFamily: fonts.regular, fontSize: 12 },
});
