import { getCliCatalog, setCliAppEnabled, usableCliApps, type DtCliApp, type DtCliEntry } from '@maviechat/deeptutor-protocol';
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { useToast } from '@/components/Toast';
import { DtHeader } from '@/features/deeptutor/DtHeader';
import { useCliApps, usePersonalizationRefresh } from '@/features/deeptutor/personalization/queries';
import { CatalogBrowser } from '@/features/deeptutor/services/CatalogBrowser';
import { describeError } from '@/lib/errors';
import { DT_QUERY_ROOT, useDtAuthed } from '@/session/DeepTutorProvider';
import { fonts, radius, usePalette } from '@/theme';

/**
 * CLI Apps, as DeepTutor's page has them: command-line programs an admin installed on the server
 * that your chats can run. Switch the ones you were given on or off for yourself; browse the
 * store to ask your admin for one (installing runs it on the server, so it's theirs to do, on
 * DeepTutor's page).
 */
export default function CliApps() {
  const palette = usePalette();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { client, session } = useDtAuthed();
  const apps = useCliApps();
  const refresh = usePersonalizationRefresh();
  const [tab, setTab] = useState<'yours' | 'store'>('yours');
  const [entry, setEntry] = useState<DtCliEntry | null>(null);
  const [switching, setSwitching] = useState<string | null>(null);
  // DeepTutor's page opens once the sheet has gone (iOS shows one at a time).
  const toWeb = useRef(false);
  const admin = session.account.isAdmin;
  const data = apps.data;

  const toggle = async (app: DtCliApp, on: boolean) => {
    setSwitching(app.id);
    try {
      queryClient.setQueryData([DT_QUERY_ROOT, session.baseUrl, 'personalization', 'cli-apps'], await setCliAppEnabled(client, app.id, on));
    } catch (error) {
      toast(`Couldn’t switch it: ${describeError(error)}`, 'error');
    } finally {
      setSwitching(null);
    }
  };

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      <DtHeader title="CLI Apps" menu={[{ key: 'web', label: 'Open on the Web', icon: 'globe-alt', onPress: () => router.push({ pathname: '/learn/web', params: { path: '/space/cli-apps', title: 'CLI Apps' } }) }]} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={false} onRefresh={refresh} />}>
        <Text style={[styles.intro, { color: palette.textMuted }]}>
          {`Command-line programs on the server your chats can run.${data ? ` ${usableCliApps(data).length} ${usableCliApps(data).length === 1 ? 'is' : 'are'} on for you.` : ''}`}
        </Text>
        <View style={styles.segments}>
          {(['yours', 'store'] as const).map((key) => {
            const on = tab === key;
            return (
              <Pressable key={key} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={() => setTab(key)} style={[styles.segment, { borderColor: palette.border }, on && { backgroundColor: palette.active, borderColor: palette.active }]}>
                <Text style={[styles.segmentText, { color: on ? palette.onActive : palette.textMuted }]}>{key === 'yours' ? `Installed${data ? ` ${data.apps.length}` : ''}` : 'Store'}</Text>
              </Pressable>
            );
          })}
        </View>
        {tab === 'yours' ? (
          <>
            {apps.isLoading ? <ActivityIndicator color={palette.textMuted} /> : null}
            {apps.isError ? <Text style={[styles.note, { color: palette.danger }]}>{`Couldn’t load the apps: ${describeError(apps.error)}`}</Text> : null}
            {data?.execDenied ? <Text style={[styles.banner, { color: palette.danger, borderColor: palette.danger }]}>Your account may not run programs on the server, so no app works for you, even ones listed here.</Text> : null}
            {data && !data.apps.length ? (
              <View style={[styles.emptyCard, { borderColor: palette.border }]}>
                <Icon name="command-line" size={28} color={palette.textFaint} />
                <Text style={[styles.emptyText, { color: palette.textMuted }]}>
                  {admin ? 'No apps installed yet. Browse the store, then install on DeepTutor’s page.' : 'No apps yet. An admin installs them and gives them to you: browse the store to ask for one by name.'}
                </Text>
                <Button label="Browse the Store" variant="secondary" onPress={() => setTab('store')} />
              </View>
            ) : null}
            {data?.apps.map((app) => (
              <View key={app.id} style={[styles.row, { borderColor: palette.border }]}>
                <View style={styles.text}>
                  <Text style={[styles.name, { color: palette.text }]}>{app.name}</Text>
                  <Text style={[styles.mono, { color: palette.textMuted }]}>{app.toolName}</Text>
                  {app.description ? (
                    <Text style={[styles.detail, { color: palette.textMuted }]} numberOfLines={3}>
                      {app.description}
                    </Text>
                  ) : null}
                  <Text style={[styles.marks, { color: palette.textFaint }]}>{[app.firstParty ? 'First-party' : 'Third-party', app.pin ? '' : 'Follows the latest version', app.version].filter(Boolean).join(' · ')}</Text>
                  {!app.inCatalog ? <Text style={[styles.detail, { color: palette.warning }]}>No longer in DeepTutor’s store, so chats don’t get it.</Text> : null}
                  {!app.granted ? <Text style={[styles.detail, { color: palette.textMuted }]}>An admin has to give it to you first.</Text> : null}
                </View>
                {app.granted ? switching === app.id ? <ActivityIndicator color={palette.textMuted} /> : <Switch accessibilityLabel={`${app.name} on`} value={app.enabled} onValueChange={(on) => void toggle(app, on)} /> : <Icon name="lock-closed" size={16} color={palette.textFaint} />}
              </View>
            ))}
          </>
        ) : (
          <>
            {!admin ? <Text style={[styles.note, { color: palette.textMuted }]}>Installing an app runs its installer on the server, so only admins do it: ask yours for one by name.</Text> : null}
            <CatalogBrowser<DtCliEntry>
              queryKey={[DT_QUERY_ROOT, session.baseUrl, 'cli-store']}
              load={({ q, category, cursor, extra }) => getCliCatalog(client, { q, category, cursor, limit: 24, installableOnly: !extra })}
              toggle={{ label: 'Show ones that can’t be installed', initial: false }}
              empty="The store is empty."
              renderRow={(row) => (
                <Pressable accessibilityRole="button" onPress={() => setEntry(row)} style={({ pressed }) => [styles.row, { borderColor: palette.border, backgroundColor: pressed ? palette.surface : 'transparent' }]}>
                  <View style={styles.text}>
                    <Text style={[styles.name, { color: palette.text }]}>{row.name}</Text>
                    <Text style={[styles.detail, { color: palette.textMuted }]} numberOfLines={2}>
                      {row.description}
                    </Text>
                    <Text style={[styles.marks, { color: palette.textFaint }]}>{[row.installed ? 'Installed' : '', row.installable ? '' : 'Can’t be installed', row.firstParty ? '' : 'Third-party'].filter(Boolean).join(' · ')}</Text>
                  </View>
                  <Icon name="chevron-right" size={14} color={palette.textFaint} />
                </Pressable>
              )}
            />
          </>
        )}
      </ScrollView>
      <Modal
        visible={entry !== null}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setEntry(null)}
        onDismiss={() => {
          if (!toWeb.current) return;
          toWeb.current = false;
          router.push({ pathname: '/learn/web', params: { path: '/space/cli-apps', title: 'CLI Apps' } });
        }}>
        <View style={[styles.screen, { backgroundColor: palette.background }]}>
          <View style={styles.header}>
            <View style={styles.placeholder} />
            <Text style={[styles.title, { color: palette.text }]} accessibilityRole="header" numberOfLines={1}>
              {entry?.name ?? ''}
            </Text>
            <Pressable accessibilityRole="button" onPress={() => setEntry(null)} hitSlop={10}>
              <Text style={[styles.action, { color: palette.link }]}>Done</Text>
            </Pressable>
          </View>
          {entry ? (
            <ScrollView contentContainerStyle={styles.content}>
              {entry.installed ? <Text style={[styles.note, { color: palette.success }]}>Installed</Text> : null}
              <Text style={[styles.body, { color: palette.text }]}>{entry.description}</Text>
              <Text style={[styles.note, { color: palette.textMuted }]}>{[entry.firstParty ? 'First-party' : 'Third-party', entry.pinned ? 'a fixed, reviewed version' : 'follows the latest version'].join(', ')}</Text>
              {entry.requires ? <Text style={[styles.note, { color: palette.textMuted }]}>{`It needs: ${entry.requires}`}</Text> : null}
              {entry.notes ? <Text style={[styles.note, { color: palette.textMuted }]}>{entry.notes}</Text> : null}
              {!entry.installable ? <Text style={[styles.note, { color: palette.warning }]}>{`It can’t be installed here${entry.unsupportedReason ? `: ${entry.unsupportedReason}` : '.'}`}</Text> : null}
              <View style={styles.links}>
                {entry.homepage ? (
                  <Pressable accessibilityRole="link" onPress={() => void WebBrowser.openBrowserAsync(entry.homepage)} hitSlop={6}>
                    <Text style={[styles.link, { color: palette.link }]}>Website</Text>
                  </Pressable>
                ) : null}
                {entry.source ? (
                  <Pressable accessibilityRole="link" onPress={() => void WebBrowser.openBrowserAsync(entry.source)} hitSlop={6}>
                    <Text style={[styles.link, { color: palette.link }]}>Source</Text>
                  </Pressable>
                ) : null}
              </View>
              {admin && entry.installable ? (
                <Button
                  label="Install on DeepTutor’s Page"
                  variant="secondary"
                  onPress={() => {
                    toWeb.current = true;
                    setEntry(null);
                  }}
                />
              ) : !admin ? (
                <Text style={[styles.note, { color: palette.textMuted }]}>Only admins install apps.</Text>
              ) : null}
            </ScrollView>
          ) : null}
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 16, gap: 10, paddingBottom: 48 },
  intro: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20 },
  segments: { flexDirection: 'row', gap: 8 },
  segment: { flex: 1, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth },
  segmentText: { fontFamily: fonts.medium, fontSize: 13 },
  note: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  banner: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, padding: 10, borderWidth: 1, borderRadius: radius.md },
  emptyCard: { alignItems: 'center', gap: 10, padding: 24, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg, borderStyle: 'dashed' },
  emptyText: { fontFamily: fonts.regular, fontSize: 13, textAlign: 'center', lineHeight: 18 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg },
  text: { flex: 1, gap: 3 },
  name: { fontFamily: fonts.semibold, fontSize: 15 },
  mono: { fontFamily: fonts.mono, fontSize: 12 },
  detail: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  marks: { fontFamily: fonts.regular, fontSize: 11 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
  title: { flex: 1, textAlign: 'center', fontFamily: fonts.semibold, fontSize: 17 },
  action: { fontFamily: fonts.semibold, fontSize: 16 },
  placeholder: { width: 40 },
  body: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 21 },
  links: { flexDirection: 'row', gap: 20 },
  link: { fontFamily: fonts.medium, fontSize: 14 },
});
