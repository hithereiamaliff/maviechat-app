import { deletePartner, DISCUSSION_MODE_LABELS, startPartner, stopPartner, type DtPartner, type DtPartnerGroup, type DtPartnerRecent } from '@maviechat/deeptutor-protocol';
import { router } from 'expo-router';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { MenuButton } from '@/components/Menu';
import { useToast } from '@/components/Toast';
import { DtHeader } from '@/features/deeptutor/DtHeader';
import { channelLabel, shortWhen } from '@/features/deeptutor/partners/labels';
import { PartnerFace } from '@/features/deeptutor/partners/PartnerFace';
import { useDtPartnerGroups, useDtPartnerRecent, useDtPartners, usePartnersRefresh } from '@/features/deeptutor/partners/queries';
import { describeError } from '@/lib/errors';
import { useDtAuthed } from '@/session/DeepTutorProvider';
import { fonts, radius, usePalette } from '@/theme';

/** DeepTutor's own page for what the app doesn't do yet (groups until B6.3), with a way back. */
function openOnWeb(path: string, title: string) {
  router.push({ pathname: '/learn/web', params: { path, title } });
}

/**
 * Partners, as DeepTutor's page lists them: your partners (and ones shared with you) with whether
 * each is running and the chat apps it's in, your latest conversations, and your groups.
 */
export default function Partners() {
  const palette = usePalette();
  const partners = useDtPartners();
  const groups = useDtPartnerGroups();
  const recent = useDtPartnerRecent();
  const refresh = usePartnersRefresh();
  const list = partners.data ?? [];
  const byId = new Map(list.map((partner) => [partner.id, partner]));
  const groupById = new Map((groups.data ?? []).map((group) => [group.id, group]));
  const shared = list.some((partner) => !partner.canManage);

  const openRecent = (row: DtPartnerRecent) => {
    if (row.kind === 'partner') router.push({ pathname: '/learn/partners/[id]', params: { id: row.ownerId, session: row.sessionKey } });
    else openOnWeb(`/partners/groups/${encodeURIComponent(row.ownerId)}?session=${encodeURIComponent(row.sessionKey)}`, row.ownerName || 'Group');
  };

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      <DtHeader title="Partners" />
      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={false} onRefresh={refresh} />}>
        <Text style={[styles.intro, { color: palette.textMuted }]}>
          {shared
            ? 'Companions with their own soul, model and library: yours, and ones shared with you. Talk to them here, or in the chat apps they’re connected to.'
            : 'Companions with their own soul, model and library. Talk to them here, or in the chat apps they’re connected to.'}
        </Text>
        <Button label="New Partner" onPress={() => router.push('/learn/partners/new')} />

        {partners.isLoading ? <ActivityIndicator style={styles.loading} color={palette.textMuted} /> : null}
        {partners.isError ? <Text style={[styles.empty, { color: palette.textMuted }]}>{`Couldn’t load your partners: ${describeError(partners.error)}`}</Text> : null}
        {partners.data && !list.length ? (
          <View style={[styles.emptyCard, { borderColor: palette.border }]}>
            <Icon name="user-group" size={28} color={palette.textFaint} />
            <Text style={[styles.emptyTitle, { color: palette.text }]}>Create your first partner</Text>
            <Text style={[styles.emptyText, { color: palette.textMuted }]}>Pick a soul (a personality), a face and a model. Connecting chat apps is optional.</Text>
          </View>
        ) : null}
        {list.map((partner) => (
          <PartnerCard key={partner.id} partner={partner} onPress={() => router.push({ pathname: '/learn/partners/[id]', params: { id: partner.id } })} />
        ))}

        {(recent.data ?? []).length ? (
          <>
            <Text style={[styles.section, { color: palette.textMuted }]} accessibilityRole="header">
              Recent Conversations
            </Text>
            <View style={[styles.group, { borderColor: palette.border }]}>
              {(recent.data ?? []).slice(0, 12).map((row, index) => {
                const owner = row.kind === 'partner' ? byId.get(row.ownerId) : groupById.get(row.ownerId);
                return (
                  <Pressable
                    key={`${row.kind}:${row.ownerId}:${row.sessionKey}`}
                    accessibilityRole="button"
                    onPress={() => openRecent(row)}
                    style={({ pressed }) => [styles.recent, index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.border }, pressed && { backgroundColor: palette.surface }]}>
                    <PartnerFace face={{ name: row.ownerName, emoji: owner?.emoji ?? (row.kind === 'group' ? '👥' : ''), color: owner?.color, avatar: row.kind === 'partner' ? (owner as DtPartner | undefined)?.avatar : undefined }} size={30} />
                    <View style={styles.recentText}>
                      <Text style={[styles.recentTitle, { color: palette.text }]} numberOfLines={1}>
                        {row.title || 'New conversation'}
                      </Text>
                      <Text style={[styles.meta, { color: palette.textFaint }]} numberOfLines={1}>
                        {[row.ownerName, row.kind === 'group' ? 'group' : null, shortWhen(row.updatedAt)].filter(Boolean).join(' · ')}
                      </Text>
                    </View>
                    <Icon name="chevron-right" size={14} color={palette.textFaint} />
                  </Pressable>
                );
              })}
            </View>
          </>
        ) : null}

        {list.length ? (
          <>
            <View style={styles.sectionRow}>
              <Text style={[styles.section, { color: palette.textMuted }]} accessibilityRole="header">
                Groups
              </Text>
              {list.length >= 2 ? (
                <Pressable accessibilityRole="button" onPress={() => openOnWeb('/partners/groups/new', 'New Group')} hitSlop={8} style={styles.add}>
                  <Icon name="plus" size={14} color={palette.link} />
                  <Text style={[styles.addText, { color: palette.link }]}>New Group</Text>
                </Pressable>
              ) : null}
            </View>
            {(groups.data ?? []).length ? (
              (groups.data ?? []).map((group) => <GroupCard key={group.id} group={group} />)
            ) : (
              <Text style={[styles.hint, { color: palette.textFaint }]}>
                {list.length >= 2 ? 'A group puts several partners on one question: they answer side by side, in turn, or argue it out.' : 'Make a second partner to start a group.'}
              </Text>
            )}
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

function PartnerCard({ partner, onPress }: { partner: DtPartner; onPress: () => void }) {
  const palette = usePalette();
  const toast = useToast();
  const { client } = useDtAuthed();
  const refresh = usePartnersRefresh();
  const run = (action: () => Promise<void>, done: string) =>
    action().then(
      () => {
        refresh();
        toast(done);
      },
      (error: unknown) => toast(`Couldn’t do that: ${describeError(error)}`, 'error'),
    );
  const remove = () =>
    Alert.alert(`Delete ${partner.name}?`, 'Its conversations, library and chat-app links are deleted too. This can’t be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => void run(() => deletePartner(client, partner.id), `${partner.name} deleted`) },
    ]);
  return (
    <Pressable accessibilityRole="button" accessibilityHint="Opens a chat with this partner" onPress={onPress} style={({ pressed }) => [styles.card, { borderColor: palette.border }, pressed && { backgroundColor: palette.surface }]}>
      <PartnerFace face={partner} size={44} running={partner.running} />
      <View style={styles.cardText}>
        <View style={styles.nameRow}>
          <Text style={[styles.name, { color: palette.text }]} numberOfLines={1}>
            {partner.name}
          </Text>
          {!partner.canManage ? <Text style={[styles.pill, { color: palette.textMuted, borderColor: palette.border }]}>Shared with you</Text> : null}
        </View>
        {partner.description ? (
          <Text style={[styles.description, { color: palette.textMuted }]} numberOfLines={2}>
            {partner.description}
          </Text>
        ) : null}
        {partner.canManage ? (
          <Text style={[styles.meta, { color: palette.textFaint }]} numberOfLines={1}>
            {[partner.running ? 'Running' : 'Stopped', partner.channels.length ? partner.channels.map(channelLabel).join(', ') : 'No chat apps connected'].join(' · ')}
          </Text>
        ) : null}
        {partner.lastReloadError ? (
          <Text style={[styles.meta, { color: palette.danger }]} numberOfLines={2}>
            Its chat apps failed to restart: stop and start it.
          </Text>
        ) : null}
      </View>
      {partner.canManage ? (
        <MenuButton
          label={`Options for ${partner.name}`}
          size={18}
          color={palette.textMuted}
          items={[
            partner.running
              ? { key: 'stop', label: 'Stop', icon: 'stop-circle', onPress: () => void run(() => stopPartner(client, partner.id), `${partner.name} stopped`) }
              : { key: 'start', label: 'Start', icon: 'play', onPress: () => void run(() => startPartner(client, partner.id), `${partner.name} started`) },
            { key: 'delete', label: 'Delete', icon: 'trash', destructive: true, onPress: remove },
          ]}
        />
      ) : null}
    </Pressable>
  );
}

function GroupCard({ group }: { group: DtPartnerGroup }) {
  const palette = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint="Opens the group in DeepTutor’s web app"
      onPress={() => openOnWeb(`/partners/groups/${encodeURIComponent(group.id)}`, group.name)}
      style={({ pressed }) => [styles.card, { borderColor: palette.border }, pressed && { backgroundColor: palette.surface }]}>
      <View style={[styles.tile, { backgroundColor: group.color ? `${group.color}33` : palette.surfaceStrong }]}>
        <Text style={styles.tileEmoji}>{group.emoji}</Text>
      </View>
      <View style={styles.cardText}>
        <Text style={[styles.name, { color: palette.text }]} numberOfLines={1}>
          {group.name}
        </Text>
        {group.description ? (
          <Text style={[styles.description, { color: palette.textMuted }]} numberOfLines={2}>
            {group.description}
          </Text>
        ) : null}
        <View style={styles.members}>
          {group.members.slice(0, 5).map((member) => (
            <PartnerFace key={member.id} face={member} size={20} />
          ))}
          <Text style={[styles.meta, { color: palette.textFaint }]} numberOfLines={1}>
            {[`${group.members.length} members`, DISCUSSION_MODE_LABELS[group.mode] ?? group.mode, shortWhen(group.updatedAt)].filter(Boolean).join(' · ')}
          </Text>
        </View>
      </View>
      <Icon name="arrow-top-right-on-square" size={14} color={palette.textFaint} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 16, gap: 10, paddingBottom: 48 },
  intro: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20 },
  loading: { marginTop: 24 },
  empty: { fontFamily: fonts.regular, fontSize: 14, textAlign: 'center', marginTop: 16 },
  emptyCard: { alignItems: 'center', gap: 8, padding: 24, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg, borderStyle: 'dashed' },
  emptyTitle: { fontFamily: fonts.semibold, fontSize: 16 },
  emptyText: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, textAlign: 'center' },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg },
  cardText: { flex: 1, gap: 3 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { flexShrink: 1, fontFamily: fonts.semibold, fontSize: 16 },
  pill: { fontFamily: fonts.medium, fontSize: 11, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.full, paddingHorizontal: 7, paddingVertical: 1, overflow: 'hidden' },
  description: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 19 },
  meta: { fontFamily: fonts.regular, fontSize: 12, flexShrink: 1 },
  section: { fontFamily: fonts.medium, fontSize: 13, marginTop: 14, marginLeft: 4 },
  sectionRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  add: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingRight: 4 },
  addText: { fontFamily: fonts.medium, fontSize: 14 },
  hint: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, marginHorizontal: 4 },
  group: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg, overflow: 'hidden' },
  recent: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 10 },
  recentText: { flex: 1, gap: 2 },
  recentTitle: { fontFamily: fonts.medium, fontSize: 15 },
  tile: { width: 44, height: 44, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  tileEmoji: { fontSize: 22 },
  members: { flexDirection: 'row', alignItems: 'center', gap: 2 },
});
