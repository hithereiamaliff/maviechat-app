import {
  attachmentUrl,
  errorText,
  groupSteps,
  isImageItem,
  latestStatus,
  messageBlocks,
  normalizeSources,
  plainText,
  type FileItem,
  type HistoryMessage,
} from '@maviechat/owui-protocol';
import * as Clipboard from 'expo-clipboard';
import { Image } from 'expo-image';
import { memo, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { MenuButton, type MenuItem } from '@/components/Menu';
import { useToast } from '@/components/Toast';
import { Markdown } from '@/markdown/Markdown';
import { fonts, radius, usePalette } from '@/theme';
import { BranchNav } from './BranchNav';
import { Sources } from './Sources';
import { StepGroup, StepView } from './Steps';

function usageSummary(usage: Record<string, unknown> | undefined): string | null {
  if (!usage) return null;
  const read = (...keys: string[]) => keys.map((key) => usage[key]).find((value) => typeof value === 'number') as number | undefined;
  const input = read('prompt_tokens', 'input_tokens');
  const output = read('completion_tokens', 'output_tokens');
  const total = read('total_tokens');
  const lines = [
    input !== undefined ? `Input tokens: ${input}` : null,
    output !== undefined ? `Output tokens: ${output}` : null,
    total !== undefined ? `Total tokens: ${total}` : null,
    typeof usage.cost === 'number' ? `Cost: ${usage.cost}` : null,
  ].filter(Boolean);
  return lines.length ? lines.join('\n') : null;
}

export const AssistantMessage = memo(function AssistantMessage({
  message,
  modelLabel,
  branch,
  onStep,
  isLast,
  baseUrl,
  token,
  onFollowUp,
  onRegenerate,
  onDelete,
}: {
  message: HistoryMessage;
  modelLabel: string;
  branch: { index: number; count: number };
  onStep: (step: -1 | 1) => void;
  isLast: boolean;
  baseUrl: string;
  token: string;
  /** Sends a suggested follow-up (shown under the last reply once it's done). */
  onFollowUp?: (text: string) => void;
  /** Asks for another version of this reply, optionally steered ("More Concise", your own words). */
  onRegenerate?: (prompt?: string) => void;
  onDelete?: () => void;
}) {
  const palette = usePalette();
  const toast = useToast();
  const [revealed, setRevealed] = useState(false);
  const blocks = useMemo(() => messageBlocks(message), [message]);
  const items = useMemo(() => groupSteps(blocks), [blocks]);
  const sources = useMemo(() => normalizeSources(message.sources), [message.sources]);
  const status = latestStatus(message.statusHistory);
  const error = errorText(message.error);
  const streaming = message.done === false;
  const usage = usageSummary(message.usage);
  const showActions = isLast || revealed;
  const images = useMemo(
    () => (Array.isArray(message.files) ? (message.files as FileItem[]).filter((file) => file && typeof file === 'object' && isImageItem(file)) : []),
    [message.files],
  );
  const regenerateItems: MenuItem[] = onRegenerate
    ? [
        { key: 'again', label: 'Try Again', icon: 'arrow-path', onPress: () => onRegenerate() },
        { key: 'details', label: 'Add Details', icon: 'bars-arrow-down', onPress: () => onRegenerate('Add Details') },
        { key: 'concise', label: 'More Concise', icon: 'bars-arrow-up', onPress: () => onRegenerate('More Concise') },
        ...(Platform.OS === 'ios'
          ? [
              {
                key: 'suggest',
                label: 'Suggest a change',
                icon: 'chat-bubble-bottom-center-text' as const,
                onPress: () =>
                  Alert.prompt('Suggest a change', undefined, [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Regenerate',
                      onPress: (value?: string) => {
                        const prompt = value?.trim();
                        if (prompt) onRegenerate(prompt);
                      },
                    },
                  ]),
              },
            ]
          : []),
      ]
    : [];

  return (
    <Pressable onPress={() => setRevealed((value) => !value)} style={styles.wrap} accessibilityHint="Shows message actions">
      <Text style={[styles.model, { color: palette.text }]} numberOfLines={1}>
        {modelLabel}
      </Text>

      {status ? (
        <View style={styles.status}>
          {status.done ? (
            <Icon name="check" size={14} color={palette.textMuted} strokeWidth={2} />
          ) : (
            <ActivityIndicator size="small" color={palette.textMuted} />
          )}
          <Text style={[styles.statusText, { color: palette.textMuted }]} numberOfLines={2}>
            {status.description}
          </Text>
        </View>
      ) : null}

      {images.length > 0 ? (
        <View style={styles.images}>
          {images.map((file, index) => {
            const url = attachmentUrl(file, baseUrl);
            return url ? (
              <Image
                key={index}
                accessibilityLabel={typeof file.name === 'string' ? file.name : 'Generated image'}
                source={{ uri: url, headers: url.startsWith(baseUrl) ? { Authorization: `Bearer ${token}` } : undefined }}
                style={[styles.image, { backgroundColor: palette.surface }]}
                contentFit="cover"
              />
            ) : null;
          })}
        </View>
      ) : null}

      {items.map((item) =>
        item.kind === 'text' ? (
          <Markdown key={item.id} text={item.text} sources={sources} baseUrl={baseUrl} token={token} />
        ) : item.kind === 'group' ? (
          <StepGroup key={item.id} item={item} />
        ) : (
          <StepView key={item.id} step={item} />
        ),
      )}

      {streaming && items.length === 0 && !status ? <ActivityIndicator style={styles.pending} color={palette.textMuted} /> : null}

      {error ? (
        <View style={[styles.error, { borderColor: palette.danger }]}>
          <Icon name="exclamation-triangle" size={16} color={palette.danger} />
          <Text style={[styles.errorText, { color: palette.danger }]}>{error}</Text>
        </View>
      ) : null}

      <Sources sources={sources} />

      {isLast && !streaming && onFollowUp && (message.followUps?.length ?? 0) > 0 ? (
        <View style={styles.followUps}>
          <Text style={[styles.followUpTitle, { color: palette.textMuted }]}>Follow up</Text>
          {message.followUps?.map((followUp, index) => (
            <Pressable
              key={index}
              accessibilityRole="button"
              onPress={() => onFollowUp(followUp)}
              style={({ pressed }) => [styles.followUp, { borderColor: palette.border }, pressed && { backgroundColor: palette.surface }]}>
              <Text style={[styles.followUpText, { color: palette.text }]}>{followUp}</Text>
              <Icon name="arrow-up" size={14} color={palette.textMuted} strokeWidth={2} />
            </Pressable>
          ))}
        </View>
      ) : null}

      {showActions && !streaming ? (
        <View style={styles.actions}>
          <BranchNav index={branch.index} count={branch.count} onStep={onStep} />
          <IconButton
            icon="clipboard-document"
            label="Copy response"
            size={18}
            color={palette.textMuted}
            onPress={() => {
              void Clipboard.setStringAsync(plainText(blocks)).then(() => toast('Copied to clipboard'));
            }}
          />
          {usage ? (
            <IconButton
              icon="information-circle"
              label="Usage"
              size={18}
              color={palette.textMuted}
              onPress={() => Alert.alert('Usage', usage)}
            />
          ) : null}
          {regenerateItems.length > 0 ? <MenuButton items={regenerateItems} label="Regenerate" icon="arrow-path" size={18} color={palette.textMuted} /> : null}
          {onDelete ? <IconButton icon="trash" label="Delete" size={18} color={palette.textMuted} onPress={onDelete} /> : null}
        </View>
      ) : null}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  wrap: { marginTop: 18 },
  model: { fontFamily: fonts.semibold, fontSize: 15, marginBottom: 4 },
  status: { flexDirection: 'row', alignItems: 'center', gap: 8, marginVertical: 4 },
  statusText: { flexShrink: 1, fontFamily: fonts.medium, fontSize: 14 },
  pending: { alignSelf: 'flex-start', marginVertical: 8 },
  images: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginVertical: 6 },
  image: { width: 220, height: 220, borderRadius: radius.lg },
  error: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
    marginVertical: 8,
    padding: 12,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  errorText: { flex: 1, fontFamily: fonts.regular, fontSize: 14, lineHeight: 20 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 2, marginTop: 4, marginLeft: -8 },
  followUps: { marginTop: 10, gap: 6 },
  followUpTitle: { fontFamily: fonts.medium, fontSize: 13 },
  followUp: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  followUpText: { flex: 1, fontFamily: fonts.regular, fontSize: 14, lineHeight: 20 },
});
