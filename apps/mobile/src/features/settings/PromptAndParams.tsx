import { customParamsOf, paramsFor, withCustomParams, withParam, type CustomParam, type UserSettings } from '@maviechat/owui-protocol';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { useToast } from '@/components/Toast';
import { CustomParams } from '@/features/chat/controls/CustomParams';
import { ParamRow } from '@/features/chat/controls/ParamRow';
import { useCapabilities, useUserSettings } from '@/lib/server';
import { useCanSaveSettings, useSaveUiSettings } from '@/lib/uiSettings';
import { fonts, radius, usePalette } from '@/theme';
import { Note, SectionTitle } from './rows';

interface Draft {
  system: string;
  params: Record<string, unknown>;
  /** Custom parameters (admins), as rows: one without a name isn't saved. */
  custom: CustomParam[];
}

/** What's saved, as edited here: stop sequences are kept as a list and edited as one line. */
function fromSettings(ui: UserSettings['ui']): Draft {
  const params = { ...((ui?.params as Record<string, unknown> | undefined) ?? {}) };
  if (Array.isArray(params.stop)) params.stop = params.stop.map(String).join(', ');
  return { system: typeof ui?.system === 'string' ? ui.system : '', params, custom: customParamsOf(params) };
}

/** As the web saves them: an empty prompt is no prompt, and stop sequences are a list. */
function toSettings(draft: Draft): Record<string, unknown> {
  const params = withCustomParams(draft.params, draft.custom);
  if (typeof params.stop === 'string') {
    const stops = params.stop
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);
    if (stops.length) params.stop = stops;
    else delete params.stop;
  }
  return { system: draft.system.trim() ? draft.system : undefined, params };
}

/**
 * General's Open WebUI part: your system prompt and the parameters every chat starts with,
 * saved with Save as on the web. Parameters set elsewhere (tool approvals in the + menu) are kept.
 */
export function PromptAndParams() {
  const palette = usePalette();
  const toast = useToast();
  const capabilities = useCapabilities();
  const settings = useUserSettings();
  const save = useSaveUiSettings();
  const canSave = useCanSaveSettings();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [showParams, setShowParams] = useState(false);
  const [saving, setSaving] = useState(false);
  const shown = draft ?? fromSettings(settings.data?.ui);
  const admin = capabilities?.isAdmin ?? false;
  const controls = admin || (capabilities?.can('chat.controls', true) ?? false);
  const systemAllowed = admin || (controls && (capabilities?.can('chat.system_prompt', true) ?? false));
  const paramsAllowed = admin || (controls && (capabilities?.can('chat.params', true) ?? false));
  if (!systemAllowed && !paramsAllowed) return null;
  const specs = paramsFor(admin);
  const edit = (change: Partial<Draft>) => setDraft({ ...shown, ...change });

  const submit = async () => {
    if (!draft) return;
    setSaving(true);
    const ok = await save(toSettings(draft));
    setSaving(false);
    if (ok) {
      setDraft(null);
      toast('Saved');
    }
  };

  return (
    <View style={styles.wrap}>
      {systemAllowed ? (
        <>
          <SectionTitle title="System Prompt" />
          <TextInput
            value={shown.system}
            onChangeText={(system) => edit({ system })}
            placeholder="Instructions every new chat starts with"
            placeholderTextColor={palette.textFaint}
            multiline
            editable={canSave}
            textAlignVertical="top"
            accessibilityLabel="System prompt"
            style={[styles.system, { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface }]}
          />
          <Note>A chat&apos;s own system prompt (its controls) replaces this one.</Note>
        </>
      ) : null}
      {paramsAllowed ? (
        <>
          <Pressable accessibilityRole="button" accessibilityState={{ expanded: showParams }} onPress={() => setShowParams(!showParams)} style={styles.paramsHeader}>
            <SectionTitle title="Advanced Parameters" />
            <View style={styles.showWrap}>
              <Text style={[styles.show, { color: palette.link }]}>{showParams ? 'Hide' : 'Show'}</Text>
              <Icon name={showParams ? 'chevron-up' : 'chevron-down'} size={13} color={palette.link} />
            </View>
          </Pressable>
          {showParams ? (
            <View style={styles.params} pointerEvents={canSave ? 'auto' : 'none'}>
              <Note>For every chat, unless the chat sets its own. Default leaves it to the model.</Note>
              {specs.map((spec) => (
                <ParamRow key={spec.key} spec={spec} value={shown.params[spec.key]} onChange={(value) => edit({ params: withParam(shown.params, spec.key, value) })} />
              ))}
              {admin ? <CustomParams rows={shown.custom} onChange={(custom) => edit({ custom })} readOnly={!canSave} /> : null}
            </View>
          ) : null}
        </>
      ) : null}
      {canSave ? (
        <View style={styles.save}>
          <Button label="Save" loading={saving} disabled={!draft || saving} onPress={() => void submit()} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  system: { minHeight: 110, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, padding: 10, fontFamily: fonts.regular, fontSize: 15, lineHeight: 21 },
  paramsHeader: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  showWrap: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingBottom: 1 },
  show: { fontFamily: fonts.medium, fontSize: 13 },
  params: { gap: 8 },
  save: { marginTop: 8 },
});
