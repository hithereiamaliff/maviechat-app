import { createWorkspaceSkill, deleteWorkspaceSkill, exportWorkspaceSkills, getWorkspaceSkill, isAtLeast, skillDraftFromMarkdown, skillsFromImport, toggleWorkspaceSkill, type SkillInput, type WorkspaceSkill, type WorkspaceView } from '@maviechat/owui-protocol';
import { useState, type ReactNode } from 'react';
import { Alert, View } from 'react-native';
import type { MenuItem } from '@/components/Menu';
import { useToast } from '@/components/Toast';
import { fileNameOf, shareFile, stampedName } from '@/features/settings/exportFile';
import { describeError } from '@/lib/errors';
import { useDebounced } from '@/lib/useDebounced';
import { useAuthed, useCapabilities } from '@/lib/server';
import { AccessSheet, type AccessTarget } from './AccessSheet';
import { CodeVersionsSheet, type CodeVersionsTarget } from './CodeVersionsSheet';
import { pickTextFile, plural } from './EditorParts';
import { ListControls } from './ListControls';
import { useWorkspaceRefresh, useWorkspaceSkills } from './queries';
import { SkillEditor, type SkillEditorTarget } from './SkillEditor';
import { ListState, listStyles, rowFacts, useWorkspaceRun, WorkspaceList, WorkspaceRow } from './WorkspaceList';

const skillJson = (skill: WorkspaceSkill) => ({ id: skill.id, name: skill.name, description: skill.description, content: skill.content ?? '', meta: skill.meta, is_active: skill.isActive, ...(skill.files.length > 1 ? { files: skill.files } : {}) });

/** Workspace skills: search, whose, order; each with its id, what it's for, and what you may do. */
export function SkillsTab({ tabs }: { tabs: (count?: number) => ReactNode }) {
  const toast = useToast();
  const { client } = useAuthed();
  const capabilities = useCapabilities();
  const refresh = useWorkspaceRefresh();
  const run = useWorkspaceRun();
  const [query, setQuery] = useState('');
  const debounced = useDebounced(query.trim(), 300);
  const [view, setView] = useState<WorkspaceView>('');
  const [byName, setByName] = useState(false);
  const [editor, setEditor] = useState<SkillEditorTarget | null>(null);
  const [sharing, setSharing] = useState<AccessTarget | null>(null);
  const [versions, setVersions] = useState<CodeVersionsTarget | null>(null);
  // 0.12 keeps each saved change of a skill as a version; whoever can read it can look.
  const versioned = isAtLeast(capabilities?.version, '0.12.0');
  const [importing, setImporting] = useState(false);
  const skills = useWorkspaceSkills({ query: debounced, view, orderBy: byName ? 'name' : 'updated_at', direction: byName ? 'asc' : 'desc' });
  const items = skills.data?.pages.flatMap((page) => page.items) ?? [];
  const canCreate = capabilities?.isAdmin || capabilities?.can('workspace.skills');
  const canImport = capabilities?.isAdmin || capabilities?.can('workspace.skills_import');
  const canExport = capabilities?.isAdmin || capabilities?.can('workspace.skills_export');

  const exportOne = async (skill: WorkspaceSkill) => {
    try {
      const full = await getWorkspaceSkill(client, skill.id);
      await shareFile(`${fileNameOf(full.name, 'skill')}.json`, JSON.stringify([skillJson(full)], null, 2));
    } catch (error) {
      toast(`Couldn’t export it: ${describeError(error)}`, 'error');
    }
  };
  const exportAll = async () => {
    try {
      const all = await exportWorkspaceSkills(client);
      if (!all.length) return toast('There are no skills to export.', 'error');
      await shareFile(stampedName('skills'), JSON.stringify(all, null, 2));
    } catch (error) {
      toast(`Couldn’t export: ${describeError(error)}`, 'error');
    }
  };
  const runImport = async (found: SkillInput[]) => {
    setImporting(true);
    const failed: string[] = [];
    for (const skill of found) {
      try {
        await createWorkspaceSkill(client, skill);
      } catch (error) {
        failed.push(`${skill.name}: ${describeError(error)}`);
      }
    }
    setImporting(false);
    refresh();
    if (!failed.length) toast(`Imported ${plural(found.length, 'skill')} (private)`);
    else toast(`Imported ${found.length - failed.length} of ${found.length}. ${failed[0]}${failed.length > 1 ? ` (and ${failed.length - 1} more)` : ''}`, 'error');
  };
  // A Markdown file opens as a new skill to look over; a JSON export makes each skill in it.
  const importSkills = async () => {
    let file: { name: string; text: string } | null;
    try {
      // Any file: iOS may not know `.md` as text, so the phone checks what it is instead.
      file = await pickTextFile('*/*');
    } catch (error) {
      return toast(`Couldn’t read the file: ${describeError(error)}`, 'error');
    }
    if (!file) return;
    if (!/\.json$/i.test(file.name)) {
      if (file.text.includes('\u0000')) return toast('That isn’t a text file: pick a Markdown (.md) or JSON export.', 'error');
      if (!file.text.trim()) return toast('The file is empty.', 'error');
      return setEditor({ kind: 'new', draft: skillDraftFromMarkdown(file.text, file.name) });
    }
    let found: ReturnType<typeof skillsFromImport>;
    try {
      found = skillsFromImport(JSON.parse(file.text));
    } catch (error) {
      return toast(`Couldn’t read the file: ${describeError(error)}`, 'error');
    }
    if (!found.skills.length) return toast('There are no skills in the file.', 'error');
    const chosen = found.skills;
    Alert.alert(`Import ${plural(chosen.length, 'skill')}?`, `Each becomes a new skill of yours, private until you share it.${found.skipped ? ` ${plural(found.skipped, 'entry', 'entries')} without a name, id or text are left out.` : ''} Any whose name or id is taken on this server won’t come in.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Import', onPress: () => void runImport(chosen) },
    ]);
  };
  const remove = (skill: WorkspaceSkill) =>
    Alert.alert(`Delete ${skill.name}?`, 'Models that use it lose it, and chats can’t pick it any more.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => run(() => deleteWorkspaceSkill(client, skill.id), `${skill.name} deleted`) },
    ]);
  const menuFor = (skill: WorkspaceSkill): MenuItem[] => [
    { key: 'open', label: skill.writeAccess ? 'Edit' : 'View', icon: skill.writeAccess ? 'pencil-square' : 'eye', onPress: () => setEditor({ kind: 'edit', id: skill.id }) },
    ...(canCreate ? [{ key: 'clone', label: 'Clone', icon: 'rectangle-stack' as const, onPress: () => setEditor({ kind: 'clone', id: skill.id }) }] : []),
    ...(versioned ? [{ key: 'versions', label: 'Versions…', icon: 'clock' as const, onPress: () => setVersions({ kind: 'skills', id: skill.id, name: skill.name, canWrite: skill.writeAccess }) }] : []),
    ...(skill.writeAccess ? [{ key: 'share', label: 'Share…', icon: 'users' as const, onPress: () => setSharing({ area: 'skills', id: skill.id, name: skill.name, grants: skill.accessGrants }) }] : []),
    ...(canExport ? [{ key: 'export', label: 'Export', icon: 'arrow-down-tray' as const, onPress: () => void exportOne(skill) }] : []),
    ...(skill.writeAccess ? [{ key: 'delete', label: 'Delete', icon: 'trash' as const, destructive: true, onPress: () => remove(skill) }] : []),
  ];
  const more: MenuItem[] = [
    ...(canImport ? [{ key: 'import', label: importing ? 'Importing…' : 'Import…', icon: 'arrow-up-tray' as const, onPress: () => void (importing ? undefined : importSkills()) }] : []),
    ...(canExport ? [{ key: 'export', label: 'Export All', icon: 'arrow-down-tray' as const, onPress: () => void exportAll() }] : []),
  ];

  const header = (
    <View style={listStyles.top}>
      {tabs(skills.data?.pages[0]?.total)}
      <ListControls query={query} setQuery={setQuery} placeholder="Search skills" view={view} setView={setView} byName={byName} setByName={setByName} onNew={canCreate ? () => setEditor({ kind: 'new' }) : undefined} more={more} />
      <ListState loading={skills.isLoading} error={skills.isError ? skills.error : null} empty={Boolean(skills.data) && !items.length} filtered={Boolean(debounced || view)} noun="skills" />
    </View>
  );

  return (
    <View style={listStyles.flex}>
      <WorkspaceList
        items={items}
        keyOf={(skill) => skill.id}
        header={header}
        paging={skills}
        onRefresh={refresh}
        renderItem={(skill) => (
          <WorkspaceRow
            title={skill.name}
            code={skill.id}
            detail={skill.description}
            facts={rowFacts(skill, view)}
            dim={!skill.isActive}
            on={skill.isActive}
            onToggle={skill.writeAccess ? () => run(() => toggleWorkspaceSkill(client, skill.id), skill.isActive ? `${skill.name} is off for everyone` : `${skill.name} is on`) : undefined}
            menu={menuFor(skill)}
            onPress={() => setEditor({ kind: 'edit', id: skill.id })}
            hint={skill.writeAccess ? 'Opens its editor' : 'Shows it'}
          />
        )}
      />
      <SkillEditor target={editor} onClose={() => setEditor(null)} />
      <CodeVersionsSheet target={versions} onClose={() => setVersions(null)} onChanged={refresh} />
      <AccessSheet target={sharing} onClose={() => setSharing(null)} onSaved={refresh} />
    </View>
  );
}
