import {
  addPartnerAssets,
  getPartnerAssets,
  getPartnerSoul,
  getPartnerToolOptions,
  listKnowledgeBases,
  listNotebooks,
  listPartnerWorkspaces,
  PARTNER_LANGUAGES,
  removePartnerAsset,
  sameSelection,
  savePartnerSoul,
  updatePartner,
  type DtLlmSelection,
  type DtPartner,
  type DtPartnerAssets,
  type DtPartnerAssetType,
  type DtPartnerChange,
  type DtPartnerTool,
} from '@maviechat/deeptutor-protocol';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { ActionSheetIOS, ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { useToast } from '@/components/Toast';
import { useDtLlmOptions } from '@/features/deeptutor/queries';
import { describeError } from '@/lib/errors';
import { DT_QUERY_ROOT, useDtAuthed } from '@/session/DeepTutorProvider';
import { fonts, radius, usePalette } from '@/theme';
import { FacePicker } from './FacePicker';
import { channelLabel } from './labels';
import { useDtSkillNames, useDtSouls, usePartnersRefresh } from './queries';

/** A section of a partner's settings, as the web's Configure tab has them: a card with a title. */
export function Card({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  const palette = usePalette();
  return (
    <View style={[styles.card, { borderColor: palette.border }]}>
      <Text style={[styles.cardTitle, { color: palette.text }]} accessibilityRole="header">
        {title}
      </Text>
      {note ? <Text style={[styles.note, { color: palette.textFaint }]}>{note}</Text> : null}
      {children}
    </View>
  );
}

/** Saves a change and reads the partner again; false (after a toast) when DeepTutor refused. */
function useSaver(partnerId: string) {
  const { client } = useDtAuthed();
  const toast = useToast();
  const refresh = usePartnersRefresh();
  return async (change: DtPartnerChange, done?: string) => {
    try {
      await updatePartner(client, partnerId, change);
      refresh();
      if (done) toast(done);
      return true;
    } catch (error) {
      toast(`Couldn’t save it: ${describeError(error)}`, 'error');
      return false;
    }
  };
}

function pick(title: string, options: string[], onPick: (index: number) => void) {
  ActionSheetIOS.showActionSheetWithOptions({ title, options: [...options, 'Cancel'], cancelButtonIndex: options.length }, (index) => {
    if (index < options.length) onPick(index);
  });
}

// ── Identity ─────────────────────────────────────────────────────────────────

/** Face, name, what it's for and reply language, saved together. */
export function IdentityCard({ partner }: { partner: DtPartner }) {
  const palette = usePalette();
  const save = useSaver(partner.id);
  const saved = { name: partner.name, description: partner.description, emoji: partner.emoji, color: partner.color, avatar: partner.avatar, language: partner.language };
  const [draft, setDraft] = useState<typeof saved | null>(null);
  const [busy, setBusy] = useState(false);
  const shown = draft ?? saved;
  const edit = (change: Partial<typeof saved>) => setDraft({ ...shown, ...change });
  const language = PARTNER_LANGUAGES.find((item) => item.code === shown.language)?.label ?? shown.language;

  return (
    <Card title="Identity">
      <FacePicker name={shown.name} emoji={shown.emoji} color={shown.color} avatar={shown.avatar} onChange={edit} />
      <Text style={[styles.label, { color: palette.textMuted }]}>Name</Text>
      <TextInput value={shown.name} onChangeText={(name) => edit({ name })} maxLength={80} autoCapitalize="words" accessibilityLabel="Name" style={[styles.input, { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface }]} />
      <Text style={[styles.label, { color: palette.textMuted }]}>What it’s for</Text>
      <TextInput
        value={shown.description}
        onChangeText={(description) => edit({ description })}
        multiline
        accessibilityLabel="Description"
        style={[styles.input, styles.short, { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface }]}
      />
      <Row label="Reply language" value={language} onPress={() => pick('Reply language', PARTNER_LANGUAGES.map((item) => item.label), (index) => edit({ language: PARTNER_LANGUAGES[index]?.code ?? '' }))} />
      <Button
        label="Save"
        loading={busy}
        disabled={!draft || !shown.name.trim() || busy}
        onPress={() => {
          setBusy(true);
          void save({ ...shown, name: shown.name.trim(), description: shown.description.trim() }, 'Saved').then((ok) => {
            setBusy(false);
            if (ok) setDraft(null);
          });
        }}
      />
    </Card>
  );
}

function Row({ label, value, onPress }: { label: string; value: string; onPress: () => void }) {
  const palette = usePalette();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${value}`} onPress={onPress} style={[styles.row, { borderColor: palette.border }]}>
      <Text style={[styles.rowLabel, { color: palette.text }]}>{label}</Text>
      <Text style={[styles.rowValue, { color: palette.textMuted }]} numberOfLines={1}>
        {value}
      </Text>
      <Icon name="chevron-down" size={14} color={palette.textMuted} />
    </Pressable>
  );
}

// ── Soul ─────────────────────────────────────────────────────────────────────

/** The soul in Markdown: read first (a failed read is never saved as empty), changed, saved. */
export function SoulCard({ partnerId }: { partnerId: string }) {
  const palette = usePalette();
  const toast = useToast();
  const { client, session } = useDtAuthed();
  const queryClient = useQueryClient();
  const key = [DT_QUERY_ROOT, session.baseUrl, 'partners', 'soul', partnerId];
  const soul = useQuery({ queryKey: key, queryFn: () => getPartnerSoul(client, partnerId) });
  const library = useDtSouls();
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const shown = draft ?? soul.data ?? '';
  const dirty = draft !== null && draft !== soul.data;

  if (soul.isError) {
    return (
      <Card title="Soul">
        <Text style={[styles.note, { color: palette.textMuted }]}>{`Couldn’t read its soul: ${describeError(soul.error)}`}</Text>
        <Button label="Try Again" variant="secondary" onPress={() => void soul.refetch()} />
      </Card>
    );
  }
  return (
    <Card title="Soul" note="Who it is and how it talks, in every message. Changes apply from its next reply.">
      {soul.isLoading ? (
        <ActivityIndicator color={palette.textMuted} />
      ) : (
        <TextInput
          value={shown}
          onChangeText={setDraft}
          multiline
          textAlignVertical="top"
          autoCapitalize="sentences"
          accessibilityLabel="Soul"
          style={[styles.input, styles.soul, { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface }]}
        />
      )}
      <View style={styles.buttons}>
        {(library.data ?? []).length ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              const souls = library.data ?? [];
              pick(
                'Start from the library',
                souls.map((item) => item.name),
                (index) => setDraft(souls[index]?.content ?? shown),
              );
            }}
            hitSlop={6}>
            <Text style={[styles.link, { color: palette.link }]}>Start from the Library</Text>
          </Pressable>
        ) : null}
        <View style={styles.spacer} />
        {dirty ? (
          <Pressable accessibilityRole="button" onPress={() => setDraft(null)} hitSlop={6}>
            <Text style={[styles.link, { color: palette.textMuted }]}>Undo Changes</Text>
          </Pressable>
        ) : null}
      </View>
      <Button
        label="Save Soul"
        loading={busy}
        disabled={!dirty || !shown.trim() || busy || soul.isLoading}
        onPress={() => {
          setBusy(true);
          savePartnerSoul(client, partnerId, shown).then(
            () => {
              queryClient.setQueryData(key, shown);
              setDraft(null);
              setBusy(false);
              toast('Soul saved');
            },
            (error: unknown) => {
              setBusy(false);
              toast(`Couldn’t save it: ${describeError(error)}`, 'error');
            },
          );
        }}
      />
    </Card>
  );
}

// ── Model ────────────────────────────────────────────────────────────────────

/** Its model and a backup tried when the model fails outright; each saved as you pick it. */
export function ModelCard({ partner }: { partner: DtPartner }) {
  const models = useDtLlmOptions();
  const save = useSaver(partner.id);
  const options = models.data?.options ?? [];
  const labelOf = (selection: DtLlmSelection | null, none: string) => (selection ? (options.find((option) => sameSelection(option, selection))?.label ?? selection.model_id) : none);
  const choose = (title: string, none: string, apply: (selection: DtLlmSelection | null) => DtPartnerChange) =>
    pick(title, [none, ...options.map((option) => option.label)], (index) => {
      const option = index > 0 ? options[index - 1] : undefined;
      void save(apply(option ? { profile_id: option.profile_id, model_id: option.model_id } : null), 'Saved: it applies from the next message');
    });
  return (
    <Card title="Model" note="Only the models your admin lets you use are offered.">
      <Row label="Model" value={labelOf(partner.llmSelection, 'DeepTutor’s default')} onPress={() => choose('Model', 'DeepTutor’s default', (llmSelection) => ({ llmSelection }))} />
      <Row label="Backup" value={labelOf(partner.backupLlmSelection, 'None')} onPress={() => choose('Backup model', 'None', (backupLlmSelection) => ({ backupLlmSelection }))} />
    </Card>
  );
}

// ── Tools ────────────────────────────────────────────────────────────────────

const toolName = (name: string) => {
  const words = name.replace(/^mcp__/, '').replace(/[_-]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

type ToolGroup = 'tools' | 'builtin' | 'mcp';

/** The tools it may use, in DeepTutor's three groups; memory tools are always on. Saved with Save. */
export function ToolsCard({ partner }: { partner: DtPartner }) {
  const palette = usePalette();
  const { client, session } = useDtAuthed();
  const save = useSaver(partner.id);
  const options = useQuery({ queryKey: [DT_QUERY_ROOT, session.baseUrl, 'partners', 'tool-options'], queryFn: () => getPartnerToolOptions(client), staleTime: 5 * 60_000 });
  const [draft, setDraft] = useState<Record<ToolGroup, string[]> | null>(null);
  const [open, setOpen] = useState<ToolGroup | null>(null);
  const [busy, setBusy] = useState(false);
  if (!options.data) {
    return <Card title="Tools">{options.isError ? <Text style={[styles.note, { color: palette.textMuted }]}>{describeError(options.error)}</Text> : <ActivityIndicator color={palette.textMuted} />}</Card>;
  }
  const all: Record<ToolGroup, DtPartnerTool[]> = { tools: options.data.tools, builtin: options.data.builtin, mcp: options.data.mcp };
  const saved: Record<ToolGroup, string[]> = {
    tools: partner.enabledTools ?? all.tools.map((tool) => tool.name),
    builtin: partner.builtinTools ?? all.builtin.map((tool) => tool.name),
    mcp: partner.mcpTools ?? all.mcp.map((tool) => tool.name),
  };
  const shown = draft ?? saved;
  const set = (group: ToolGroup, names: string[]) => setDraft({ ...shown, [group]: names });
  const everything = (group: ToolGroup) => all[group].every((tool) => shown[group].includes(tool.name));
  const groups: { key: ToolGroup; title: string }[] = [
    { key: 'tools', title: 'DeepTutor’s tools' },
    { key: 'builtin', title: 'Built-in tools' },
    { key: 'mcp', title: 'MCP tools' },
  ];

  return (
    <Card title="Tools" note="Its memory tools are always on.">
      {groups.map(({ key, title }) => {
        const tools = all[key];
        const on = tools.filter((tool) => shown[key].includes(tool.name)).length;
        return (
          <View key={key} style={[styles.group, { borderColor: palette.border }]}>
            <Pressable accessibilityRole="button" accessibilityState={{ expanded: open === key }} onPress={() => setOpen(open === key ? null : key)} style={styles.groupHead}>
              <Text style={[styles.rowLabel, { color: palette.text }]}>{title}</Text>
              <Text style={[styles.rowValue, { color: palette.textMuted }]}>{tools.length ? `${on} of ${tools.length}` : 'None offered'}</Text>
              {tools.length ? <Icon name={open === key ? 'chevron-up' : 'chevron-down'} size={14} color={palette.textMuted} /> : null}
            </Pressable>
            {open === key && tools.length ? (
              <>
                <View style={[styles.allNone, { borderTopColor: palette.border }]}>
                  <Pressable accessibilityRole="button" onPress={() => set(key, tools.map((tool) => tool.name))} hitSlop={6}>
                    <Text style={[styles.link, { color: palette.link }]}>All</Text>
                  </Pressable>
                  <Pressable accessibilityRole="button" onPress={() => set(key, [])} hitSlop={6}>
                    <Text style={[styles.link, { color: palette.link }]}>None</Text>
                  </Pressable>
                </View>
                {tools.map((tool) => (
                  <View key={tool.name} style={[styles.tool, { borderTopColor: palette.border }]}>
                    <View style={styles.toolText}>
                      <Text style={[styles.toolName, { color: palette.text }]}>{toolName(tool.name)}</Text>
                      {tool.description || tool.server ? (
                        <Text style={[styles.note, { color: palette.textMuted }]} numberOfLines={2}>
                          {[tool.server, tool.description].filter(Boolean).join(' · ')}
                        </Text>
                      ) : null}
                    </View>
                    <Switch
                      accessibilityLabel={toolName(tool.name)}
                      value={shown[key].includes(tool.name)}
                      onValueChange={(value) => set(key, value ? [...shown[key], tool.name] : shown[key].filter((name) => name !== tool.name))}
                    />
                  </View>
                ))}
              </>
            ) : null}
          </View>
        );
      })}
      <Button
        label="Save Tools"
        loading={busy}
        disabled={!draft || busy}
        onPress={() => {
          setBusy(true);
          // "All" stays all, including tools added later; MCP tools are always named.
          void save({ enabledTools: everything('tools') ? null : shown.tools, builtinTools: everything('builtin') ? null : shown.builtin, mcpTools: shown.mcp }, 'Tools saved').then((ok) => {
            setBusy(false);
            if (ok) setDraft(null);
          });
        }}
      />
    </Card>
  );
}

// ── Library or workspace ─────────────────────────────────────────────────────

const ASSET_LABELS: Record<DtPartnerAssetType, string> = { knowledge_base: 'Knowledge base', skill: 'Skill', notebook: 'Notebook' };

/** Its own library (copies of your knowledge bases, skills and notebooks), or one of your workspaces. */
export function LibraryCard({ partner }: { partner: DtPartner }) {
  const palette = usePalette();
  const toast = useToast();
  const { client, session } = useDtAuthed();
  const queryClient = useQueryClient();
  const save = useSaver(partner.id);
  const workspaces = useQuery({ queryKey: [DT_QUERY_ROOT, session.baseUrl, 'partners', 'workspaces', partner.id], queryFn: () => listPartnerWorkspaces(client, partner.id) });
  const assetsKey = [DT_QUERY_ROOT, session.baseUrl, 'partners', 'assets', partner.id];
  const assets = useQuery({ queryKey: assetsKey, queryFn: () => getPartnerAssets(client, partner.id), enabled: !partner.workspaceId });
  const [adding, setAdding] = useState(false);
  const bound = (workspaces.data ?? []).find((workspace) => workspace.id === partner.workspaceId);
  const where = partner.workspaceId ? (bound?.name ?? 'A workspace that’s no longer there') : 'Its own library';

  const remove = (type: DtPartnerAssetType, name: string, label: string) =>
    Alert.alert(`Remove ${label}?`, 'Its copy leaves the library. Yours stays.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () =>
          void removePartnerAsset(client, partner.id, type, name).then(
            (next) => queryClient.setQueryData(assetsKey, next),
            (error: unknown) => toast(`Couldn’t remove it: ${describeError(error)}`, 'error'),
          ),
      },
    ]);
  const items: { type: DtPartnerAssetType; name: string; label: string; detail: string }[] = assets.data
    ? [
        ...assets.data.knowledgeBases.map((kb) => ({ type: 'knowledge_base' as const, name: kb.name, label: kb.name, detail: `${ASSET_LABELS.knowledge_base} · ${kb.documents} documents` })),
        ...assets.data.skills.map((name) => ({ type: 'skill' as const, name, label: name, detail: ASSET_LABELS.skill })),
        ...assets.data.notebooks.map((notebook) => ({ type: 'notebook' as const, name: notebook.id, label: notebook.name, detail: `${ASSET_LABELS.notebook} · ${notebook.records} records` })),
      ]
    : [];

  return (
    <Card title="Library" note="What it knows besides the model: its own copies, or one of your workspaces as it is.">
      <Row
        label="Uses"
        value={where}
        onPress={() => {
          const list = workspaces.data ?? [];
          pick('What it uses', ['Its own library', ...list.map((workspace) => workspace.name)], (index) => {
            const next = index === 0 ? '' : (list[index - 1]?.id ?? '');
            if (next !== partner.workspaceId) void save({ workspaceId: next }, next ? 'It now uses that workspace' : 'It now uses its own library');
          });
        }}
      />
      {partner.workspaceId ? (
        <Text style={[styles.note, { color: palette.textMuted }]}>It reads the workspace’s knowledge, skills and notebooks as they are. Its own library is kept for if you switch back.</Text>
      ) : assets.isLoading ? (
        <ActivityIndicator color={palette.textMuted} />
      ) : (
        <>
          {items.length ? (
            <View style={[styles.group, { borderColor: palette.border }]}>
              {items.map((item, index) => (
                <View key={`${item.type}:${item.name}`} style={[styles.tool, index === 0 ? undefined : { borderTopColor: palette.border }, index === 0 && styles.first]}>
                  <View style={styles.toolText}>
                    <Text style={[styles.toolName, { color: palette.text }]} numberOfLines={1}>
                      {item.label}
                    </Text>
                    <Text style={[styles.note, { color: palette.textMuted }]}>{item.detail}</Text>
                  </View>
                  <IconButton icon="trash" label={`Remove ${item.label}`} size={17} color={palette.textMuted} onPress={() => remove(item.type, item.name, item.label)} />
                </View>
              ))}
            </View>
          ) : (
            <Text style={[styles.note, { color: palette.textFaint }]}>Its library is empty.</Text>
          )}
          <Button label="Add to Library" variant="secondary" onPress={() => setAdding(true)} />
        </>
      )}
      <AddAssetsSheet visible={adding} partnerId={partner.id} have={assets.data} onDone={(next) => queryClient.setQueryData(assetsKey, next)} onClose={() => setAdding(false)} />
    </Card>
  );
}

/** Your knowledge bases, skills and notebooks not in its library yet, to copy in. */
function AddAssetsSheet({ visible, partnerId, have, onDone, onClose }: { visible: boolean; partnerId: string; have: DtPartnerAssets | undefined; onDone: (assets: DtPartnerAssets) => void; onClose: () => void }) {
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      {visible ? <AddAssets partnerId={partnerId} have={have} onDone={onDone} onClose={onClose} /> : null}
    </Modal>
  );
}

function AddAssets({ partnerId, have, onDone, onClose }: { partnerId: string; have: DtPartnerAssets | undefined; onDone: (assets: DtPartnerAssets) => void; onClose: () => void }) {
  const palette = usePalette();
  const toast = useToast();
  const { client, session } = useDtAuthed();
  const knowledge = useQuery({ queryKey: [DT_QUERY_ROOT, session.baseUrl, 'knowledge-bases-plain'], queryFn: () => listKnowledgeBases(client) });
  const skills = useDtSkillNames();
  const notebooks = useQuery({ queryKey: [DT_QUERY_ROOT, session.baseUrl, 'notebooks-plain'], queryFn: () => listNotebooks(client) });
  const [chosen, setChosen] = useState<{ knowledgeBases: string[]; skills: string[]; notebooks: string[] }>({ knowledgeBases: [], skills: [], notebooks: [] });
  const [busy, setBusy] = useState(false);
  const sections = [
    { key: 'knowledgeBases' as const, title: 'Knowledge Bases', rows: (knowledge.data ?? []).filter((kb) => !have?.knowledgeBases.some((item) => item.name === kb.name)).map((kb) => ({ id: kb.name, label: kb.name })) },
    { key: 'skills' as const, title: 'Skills', rows: (skills.data ?? []).filter((name) => !have?.skills.includes(name)).map((name) => ({ id: name, label: name })) },
    { key: 'notebooks' as const, title: 'Notebooks', rows: (notebooks.data ?? []).filter((notebook) => !have?.notebooks.some((item) => item.id === notebook.id)).map((notebook) => ({ id: notebook.id, label: notebook.name })) },
  ];
  const count = chosen.knowledgeBases.length + chosen.skills.length + chosen.notebooks.length;
  const loading = knowledge.isLoading || skills.isLoading || notebooks.isLoading;

  const copy = async () => {
    setBusy(true);
    try {
      const result = await addPartnerAssets(client, partnerId, chosen);
      onDone(result.assets);
      if (result.errors.length) toast(`Not copied: ${result.errors.join('; ')}`, 'error');
      else toast(`Copied ${count} into its library`);
      onClose();
    } catch (error) {
      toast(`Couldn’t copy them: ${describeError(error)}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[styles.sheet, { backgroundColor: palette.background }]}>
      <View style={styles.sheetHeader}>
        <Pressable accessibilityRole="button" onPress={onClose} hitSlop={10}>
          <Text style={[styles.headerAction, { color: palette.link }]}>Cancel</Text>
        </Pressable>
        <Text style={[styles.sheetTitle, { color: palette.text }]} accessibilityRole="header">
          Add to Library
        </Text>
        {busy ? (
          <ActivityIndicator color={palette.textMuted} />
        ) : (
          <Pressable accessibilityRole="button" disabled={!count} onPress={() => void copy()} hitSlop={10}>
            <Text style={[styles.headerAction, styles.strong, { color: count ? palette.link : palette.textFaint }]}>{count ? `Copy (${count})` : 'Copy'}</Text>
          </Pressable>
        )}
      </View>
      <ScrollView contentContainerStyle={styles.sheetContent}>
        <Text style={[styles.note, { color: palette.textMuted }]}>Copies go into its library: later changes to yours don’t reach it.</Text>
        {loading ? <ActivityIndicator color={palette.textMuted} /> : null}
        {sections.map((section) => (
          <View key={section.key} style={styles.sheetSection}>
            <Text style={[styles.label, { color: palette.textMuted }]}>{section.title}</Text>
            {section.rows.length ? (
              <View style={[styles.group, { borderColor: palette.border }]}>
                {section.rows.map((row, index) => {
                  const selected = chosen[section.key].includes(row.id);
                  return (
                    <Pressable
                      key={row.id}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: selected }}
                      onPress={() => setChosen({ ...chosen, [section.key]: selected ? chosen[section.key].filter((id) => id !== row.id) : [...chosen[section.key], row.id] })}
                      style={[styles.tool, index === 0 ? styles.first : { borderTopColor: palette.border }]}>
                      <Text style={[styles.toolName, styles.toolText, { color: palette.text }]} numberOfLines={1}>
                        {row.label}
                      </Text>
                      <Icon name={selected ? 'check' : 'plus'} size={16} color={selected ? palette.link : palette.textFaint} />
                    </Pressable>
                  );
                })}
              </View>
            ) : (
              <Text style={[styles.note, { color: palette.textFaint }]}>{loading ? '' : 'Nothing more to add.'}</Text>
            )}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

// ── Chat apps ────────────────────────────────────────────────────────────────

/** The chat apps it's in; setting one up stays on DeepTutor's web page (each needs an account of its own). */
export function ChatAppsCard({ partner, onLink }: { partner: DtPartner; onLink: () => void }) {
  const palette = usePalette();
  return (
    <Card title="Chat Apps" note="Telegram, WhatsApp, Slack, WeChat and more: each needs a bot or account of its own, set up on DeepTutor’s web page.">
      <Text style={[styles.rowLabel, { color: partner.channels.length ? palette.text : palette.textFaint }]}>{partner.channels.length ? partner.channels.map(channelLabel).join(', ') : 'Not in any chat app yet'}</Text>
      {partner.lastReloadError ? <Text style={[styles.note, { color: palette.danger }]}>Its chat apps failed to restart. Stop and start it (Partners page, its menu).</Text> : null}
      <View style={styles.buttons}>
        <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/learn/web', params: { path: `/partners/${encodeURIComponent(partner.id)}?tab=channels`, title: partner.name } })} hitSlop={6}>
          <Text style={[styles.link, { color: palette.link }]}>Set Up on the Web</Text>
        </Pressable>
        <View style={styles.spacer} />
        <Pressable accessibilityRole="button" onPress={onLink} hitSlop={6}>
          <Text style={[styles.link, { color: palette.link }]}>Link Your Account</Text>
        </Pressable>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: 10, padding: 14, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg },
  cardTitle: { fontFamily: fonts.semibold, fontSize: 16 },
  note: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 17 },
  label: { fontFamily: fonts.medium, fontSize: 13, marginLeft: 2 },
  input: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10, fontFamily: fonts.regular, fontSize: 15 },
  short: { minHeight: 64, lineHeight: 21 },
  soul: { minHeight: 220, maxHeight: 420, fontFamily: fonts.mono, fontSize: 13, lineHeight: 19 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 12, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md },
  rowLabel: { flex: 1, fontFamily: fonts.regular, fontSize: 15 },
  rowValue: { flexShrink: 1, fontFamily: fonts.regular, fontSize: 15 },
  buttons: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  spacer: { flex: 1 },
  link: { fontFamily: fonts.medium, fontSize: 14 },
  group: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, overflow: 'hidden' },
  groupHead: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 12 },
  allNone: { flexDirection: 'row', gap: 16, paddingHorizontal: 12, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth },
  tool: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 9, borderTopWidth: StyleSheet.hairlineWidth },
  first: { borderTopWidth: 0 },
  toolText: { flex: 1, gap: 2 },
  toolName: { fontFamily: fonts.regular, fontSize: 15 },
  sheet: { flex: 1 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
  sheetTitle: { flex: 1, textAlign: 'center', fontFamily: fonts.semibold, fontSize: 17 },
  headerAction: { fontFamily: fonts.regular, fontSize: 16 },
  strong: { fontFamily: fonts.semibold },
  sheetContent: { padding: 16, gap: 12, paddingBottom: 48 },
  sheetSection: { gap: 6 },
});
