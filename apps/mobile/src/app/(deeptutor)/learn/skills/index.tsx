import { createSkill, createSkillTag, deleteSkill, DtHttpError, filterSkills, joinFrontMatter, skillUsage, splitFrontMatter, tagCounts, updateSkill, type DtSkill, type DtSkillFilter } from '@maviechat/deeptutor-protocol';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { useToast } from '@/components/Toast';
import { DtHeader } from '@/features/deeptutor/DtHeader';
import { ResourceEditor, type ResourceDraft } from '@/features/deeptutor/personalization/ResourceEditor';
import { ResourceRow } from '@/features/deeptutor/personalization/ResourceRow';
import { ResourceViewer } from '@/features/deeptutor/personalization/ResourceViewer';
import { SkillTagsSheet } from '@/features/deeptutor/personalization/SkillTagsSheet';
import { usePersonalizationRefresh, useSkillFile, useSkills, useSkillTags } from '@/features/deeptutor/personalization/queries';
import { describeError } from '@/lib/errors';
import { useDtAuthed } from '@/session/DeepTutorProvider';
import { fonts, radius, usePalette } from '@/theme';

const BADGES: Record<DtSkill['source'], string | undefined> = { user: undefined, builtin: 'Built-in', admin: 'From your admin' };

const sameFilter = (a: DtSkillFilter, b: DtSkillFilter) => a.kind === b.kind && (a.kind !== 'tag' || (b.kind === 'tag' && a.tag === b.tag));

/**
 * Skills, as DeepTutor's page has them: playbooks the model opens when a chat needs one. Yours you
 * can change; built-in ones and those your admin gave you are read-only. Filter by tag, and manage
 * the tags. Installing from DeepTutor's skill hub stays on its web page.
 */
export default function Skills() {
  const palette = usePalette();
  const toast = useToast();
  const { client } = useDtAuthed();
  const skills = useSkills();
  const tags = useSkillTags();
  const refresh = usePersonalizationRefresh();
  const [filter, setFilter] = useState<DtSkillFilter>({ kind: 'all' });
  const [viewing, setViewing] = useState<DtSkill | null>(null);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [editAfterView, setEditAfterView] = useState(false);
  // The skill being edited: '' for a new one, null when the editor is closed.
  const [editing, setEditing] = useState<string | null>(null);
  const [managingTags, setManagingTags] = useState(false);
  const viewFile = useSkillFile(viewing?.name ?? null);
  const editFile = useSkillFile(editing || null);
  const list = skills.data ?? [];
  const counts = tagCounts(list);
  const vocabulary = [...new Set([...(tags.data ?? []), ...Object.keys(counts.byTag)])].sort();
  // A tag deleted elsewhere leaves its filter showing everything.
  const shownFilter: DtSkillFilter = filter.kind === 'tag' && !vocabulary.includes(filter.tag) ? { kind: 'all' } : filter;
  const shown = filterSkills(list, shownFilter);
  const filters: { filter: DtSkillFilter; label: string }[] = [
    { filter: { kind: 'all' }, label: `All ${counts.all}` },
    ...vocabulary.map((tag) => ({ filter: { kind: 'tag', tag } as DtSkillFilter, label: `${tag} ${counts.byTag[tag] ?? 0}` })),
    ...(counts.untagged ? [{ filter: { kind: 'untagged' } as DtSkillFilter, label: `Untagged ${counts.untagged}` }] : []),
  ];

  const view = (skill: DtSkill) => {
    setViewing(skill);
    setViewerOpen(true);
  };
  const remove = async (skill: DtSkill) => {
    let usage: { id: string; name: string }[] = [];
    try {
      usage = await skillUsage(client, skill.name);
    } catch {
      // Deleting doesn't depend on it.
    }
    Alert.alert(`Delete ${skill.name}?`, usage.length ? `Chats in ${usage.map((row) => row.name).join(', ')} can use it now; they won’t after this.` : 'It’s gone for good.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          void deleteSkill(client, skill.name).then(
            () => {
              refresh();
              toast('Skill deleted');
            },
            (error: unknown) => toast(`Couldn’t delete it: ${describeError(error)}`, 'error'),
          ),
      },
    ]);
  };
  const save = async (draft: ResourceDraft): Promise<string | null> => {
    try {
      // Tags new to the library join it first.
      for (const tag of draft.tags.filter((item) => !(tags.data ?? []).includes(item))) {
        await createSkillTag(client, tag).catch((error: unknown) => {
          if (!(error instanceof DtHttpError && error.status === 409)) throw error;
        });
      }
      const content = joinFrontMatter({ header: draft.header, body: draft.body });
      if (!editing) await createSkill(client, { name: draft.name, description: draft.description, content, tags: draft.tags });
      else {
        const before = editFile.data ? splitFrontMatter(editFile.data.content) : null;
        const fileChanged = !before || before.header !== draft.header || before.body !== draft.body;
        await updateSkill(client, editing, { description: draft.description, tags: draft.tags, content: fileChanged ? content : undefined, renameTo: draft.name });
      }
      refresh();
      setEditing(null);
      toast('Skill saved');
      return null;
    } catch (error) {
      return describeError(error);
    }
  };
  const editSplit = editFile.data ? splitFrontMatter(editFile.data.content) : null;
  const initial: ResourceDraft | null = editing && editFile.data && editSplit ? { name: editFile.data.name, description: editFile.data.description, tags: editFile.data.tags, header: editSplit.header, body: editSplit.body } : null;

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      <DtHeader
        title="Skills"
        menu={[
          { key: 'tags', label: 'Manage Tags', icon: 'tag', onPress: () => setManagingTags(true) },
          { key: 'hub', label: 'Skill Hub on the Web', icon: 'globe-alt', onPress: () => router.push({ pathname: '/learn/web', params: { path: '/space/skills', title: 'Skills' } }) },
        ]}
      />
      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={false} onRefresh={refresh} />}>
        <Text style={[styles.intro, { color: palette.textMuted }]}>Playbooks the model opens when a chat needs one. They’re yours in every workspace; a workspace’s settings choose which its chats may use.</Text>
        <Button label="New Skill" onPress={() => setEditing('')} />
        {list.length ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            {filters.map((item) => {
              const on = sameFilter(item.filter, shownFilter);
              return (
                <Pressable
                  key={item.label}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  onPress={() => setFilter(item.filter)}
                  style={[styles.chip, { borderColor: palette.border }, on && { backgroundColor: palette.active, borderColor: palette.active }]}>
                  <Text style={[styles.chipText, { color: on ? palette.onActive : palette.textMuted }]}>{item.label}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        ) : null}
        {skills.isLoading ? <ActivityIndicator style={styles.loading} color={palette.textMuted} /> : null}
        {skills.isError ? <Text style={[styles.empty, { color: palette.textMuted }]}>{`Couldn’t load your skills: ${describeError(skills.error)}`}</Text> : null}
        {skills.data && !list.length ? (
          <View style={[styles.emptyCard, { borderColor: palette.border }]}>
            <Icon name="sparkles" size={28} color={palette.textFaint} />
            <Text style={[styles.emptyTitle, { color: palette.text }]}>No skills yet</Text>
          </View>
        ) : null}
        {list.length && !shown.length ? <Text style={[styles.empty, { color: palette.textMuted }]}>No skill has this tag.</Text> : null}
        {shown.map((skill) => (
          <ResourceRow
            key={skill.name}
            name={skill.name}
            description={skill.description}
            badge={BADGES[skill.source]}
            tags={skill.tags}
            onPress={() => view(skill)}
            menu={
              skill.readOnly
                ? undefined
                : [
                    { key: 'edit', label: 'Edit', icon: 'pencil-square', onPress: () => setEditing(skill.name) },
                    { key: 'delete', label: 'Delete', icon: 'trash', destructive: true, onPress: () => void remove(skill) },
                  ]
            }
          />
        ))}
      </ScrollView>
      <ResourceViewer
        visible={viewerOpen}
        name={viewing?.name ?? ''}
        badge={viewing?.source === 'builtin' ? 'Built into DeepTutor: read-only' : viewing?.source === 'admin' ? 'Given to you by your admin: read-only' : undefined}
        description={viewing?.description ?? ''}
        file={viewFile.data?.content}
        error={viewFile.error}
        onEdit={
          viewing && !viewing.readOnly
            ? () => {
                setEditAfterView(true);
                setViewerOpen(false);
              }
            : undefined
        }
        onClose={() => setViewerOpen(false)}
        onDismiss={() => {
          if (editAfterView && viewing) setEditing(viewing.name);
          setEditAfterView(false);
        }}
      />
      <ResourceEditor kind="skill" open={editing !== null} initial={initial} loading={Boolean(editing) && !editFile.data} error={editing ? editFile.error : undefined} vocabulary={vocabulary} onSave={save} onClose={() => setEditing(null)} />
      <SkillTagsSheet visible={managingTags} tags={vocabulary} counts={counts.byTag} onChanged={refresh} onClose={() => setManagingTags(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 16, gap: 10, paddingBottom: 48 },
  intro: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, marginBottom: 4 },
  chips: { gap: 8, paddingVertical: 4 },
  chip: { height: 32, justifyContent: 'center', paddingHorizontal: 13, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth },
  chipText: { fontFamily: fonts.medium, fontSize: 13 },
  loading: { marginTop: 24 },
  empty: { fontFamily: fonts.regular, fontSize: 14, textAlign: 'center', marginTop: 24 },
  emptyCard: { alignItems: 'center', gap: 6, padding: 24, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg, borderStyle: 'dashed' },
  emptyTitle: { fontFamily: fonts.semibold, fontSize: 15 },
});
