import { channelErrors, getChannelSchemas, getChannelStatus, getPartnerChannels, reloadPartnerChannels, savePartnerChannels, type DtChannelSchema } from '@maviechat/deeptutor-protocol';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { useToast } from '@/components/Toast';
import { DtHeader } from '@/features/deeptutor/DtHeader';
import { ChannelSheet, channelStateWords } from '@/features/deeptutor/partners/channels/ChannelSheet';
import { useDtPartner, usePartnersRefresh } from '@/features/deeptutor/partners/queries';
import { describeError } from '@/lib/errors';
import { DT_QUERY_ROOT, useDtAuthed } from '@/session/DeepTutorProvider';
import { fonts, radius, usePalette } from '@/theme';

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? (value[0] ?? '') : (value ?? ''));

/**
 * A partner's chat apps, as DeepTutor's Channels tab has them, for its owner: each app DeepTutor
 * can run, whether it's on and how it's doing, and its settings. Each app needs a bot or account of
 * its own; some connect by a scan. They listen while the partner runs.
 */
export default function PartnerChannels() {
  const palette = usePalette();
  const toast = useToast();
  const partnerId = one(useLocalSearchParams<{ id: string }>().id);
  const { client, session } = useDtAuthed();
  const refreshPartners = usePartnersRefresh();
  const partner = useDtPartner(partnerId);
  const schemas = useQuery({ queryKey: [DT_QUERY_ROOT, session.baseUrl, 'partners', 'channel-schemas'], queryFn: () => getChannelSchemas(client), staleTime: 0 });
  const saved = useQuery({ queryKey: [DT_QUERY_ROOT, session.baseUrl, 'partners', 'channels', partnerId], queryFn: () => getPartnerChannels(client, partnerId), enabled: partner.data?.canManage === true });
  const anyOn = Object.values(saved.data ?? {}).some((config) => config.enabled === true);
  const status = useQuery({
    queryKey: [DT_QUERY_ROOT, session.baseUrl, 'partners', 'channel-status', partnerId],
    queryFn: () => getChannelStatus(client, partnerId),
    enabled: partner.data?.canManage === true,
    refetchInterval: partner.data?.running && anyOn ? 2500 : false,
  });
  const [open, setOpen] = useState<DtChannelSchema | null>(null);
  const [restarting, setRestarting] = useState(false);
  const running = partner.data?.running ?? false;

  const reread = () => {
    void saved.refetch();
    void status.refetch();
    refreshPartners();
  };
  const save = async (name: string, config: Record<string, unknown> | null) => {
    try {
      // DeepTutor replaces every app's settings at once: start from what it has now, not what this
      // page read earlier, so a change made elsewhere meanwhile isn't undone.
      const all = await getPartnerChannels(client, partnerId);
      if (config) all[name] = config;
      else delete all[name];
      await savePartnerChannels(client, partnerId, all);
      reread();
      toast(config ? 'Saved' : 'Removed');
      return null;
    } catch (error) {
      const problems = channelErrors(error);
      return problems.length ? problems : [describeError(error)];
    }
  };
  const restart = async () => {
    setRestarting(true);
    try {
      await reloadPartnerChannels(client, partnerId);
      reread();
      toast('Chat apps restarted');
    } catch (error) {
      toast(`Couldn’t restart them: ${describeError(error)}`, 'error');
    } finally {
      setRestarting(false);
    }
  };

  const list = schemas.data ?? [];
  const available = list.filter((schema) => schema.available);
  const missing = list.filter((schema) => !schema.available);

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      <DtHeader title={partner.data ? `${partner.data.name}: Chat Apps` : 'Chat Apps'} />
      {partner.isError ? (
        <Text style={[styles.empty, { color: palette.textMuted }]}>{`Couldn’t load the partner: ${describeError(partner.error)}`}</Text>
      ) : partner.data && !partner.data.canManage ? (
        <Text style={[styles.empty, { color: palette.textMuted }]}>Only its owner can set up its chat apps.</Text>
      ) : (
        <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={false} onRefresh={reread} />}>
          <Text style={[styles.intro, { color: palette.textMuted }]}>
            {`Each app needs a bot or account of its own, made in that app. They listen while ${partner.data?.name ?? 'the partner'} runs${running ? '' : ' (it’s stopped: start it from the Partners page)'}.`}
          </Text>
          {partner.data?.lastReloadError ? (
            <View style={[styles.banner, { borderColor: palette.danger }]}>
              <Text style={[styles.bannerText, { color: palette.danger }]}>Its chat apps failed to restart after a change.</Text>
              {running ? <Button label="Restart Chat Apps" variant="secondary" loading={restarting} onPress={() => void restart()} /> : null}
            </View>
          ) : null}
          {schemas.isLoading || saved.isLoading ? <ActivityIndicator color={palette.textMuted} /> : null}
          {saved.isError ? <Text style={[styles.empty, { color: palette.textMuted }]}>{`Couldn’t load its settings: ${describeError(saved.error)}`}</Text> : null}
          {schemas.isError ? <Text style={[styles.empty, { color: palette.textMuted }]}>{`Couldn’t load the apps: ${describeError(schemas.error)}`}</Text> : null}
          {available.length ? (
            <View style={[styles.group, { borderColor: palette.border }]}>
              {available.map((schema, index) => {
                const config = saved.data?.[schema.name];
                const state = status.data?.channels[schema.name];
                const on = config?.enabled === true;
                const words = channelStateWords(config, state, running);
                return (
                  <Pressable
                    key={schema.name}
                    accessibilityRole="button"
                    accessibilityHint="Opens its settings"
                    onPress={() => setOpen(schema)}
                    style={({ pressed }) => [styles.row, index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.border }, pressed && { backgroundColor: palette.surface }]}>
                    <View style={[styles.dot, { backgroundColor: on ? (running ? palette.success : palette.warning) : config ? palette.textFaint : 'transparent', borderColor: palette.textFaint }]} />
                    <Text style={[styles.name, { color: palette.text }]}>{schema.displayName}</Text>
                    <Text style={[styles.state, { color: palette.textMuted }]} numberOfLines={1}>
                      {words}
                    </Text>
                    <Icon name="chevron-right" size={14} color={palette.textFaint} />
                  </Pressable>
                );
              })}
            </View>
          ) : null}
          {missing.length ? (
            <>
              <Text style={[styles.section, { color: palette.textMuted }]}>Not on this server</Text>
              {missing.map((schema) => (
                <Text key={schema.name} style={[styles.missing, { color: palette.textFaint }]}>{`${schema.displayName}: ${schema.unavailableReason || 'its add-on isn’t installed'}`}</Text>
              ))}
            </>
          ) : null}
        </ScrollView>
      )}
      <ChannelSheet
        partnerId={partnerId}
        schema={open}
        saved={open ? (saved.data?.[open.name] ?? null) : null}
        state={open ? status.data?.channels[open.name] : undefined}
        running={running}
        onSave={(config) => save(open?.name ?? '', config)}
        onRemove={async () => {
          const problems = await save(open?.name ?? '', null);
          if (problems) {
            toast(problems.join(' '), 'error');
            throw new Error(problems.join(' '));
          }
        }}
        onConnected={reread}
        onClose={() => setOpen(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 16, gap: 12, paddingBottom: 48 },
  intro: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20 },
  empty: { fontFamily: fonts.regular, fontSize: 14, textAlign: 'center', marginTop: 32, paddingHorizontal: 24 },
  banner: { gap: 8, padding: 12, borderWidth: 1, borderRadius: radius.md },
  bannerText: { fontFamily: fonts.medium, fontSize: 14 },
  group: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 12 },
  dot: { width: 9, height: 9, borderRadius: 5, borderWidth: StyleSheet.hairlineWidth },
  name: { flex: 1, fontFamily: fonts.regular, fontSize: 15 },
  state: { maxWidth: '45%', fontFamily: fonts.regular, fontSize: 13 },
  section: { fontFamily: fonts.medium, fontSize: 13, marginTop: 8, marginLeft: 4 },
  missing: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 17, marginHorizontal: 4 },
});
