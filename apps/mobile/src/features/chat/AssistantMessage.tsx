import {
  attachmentUrl,
  awaitingYou,
  embedList,
  errorText,
  groupSteps,
  isImageItem,
  latestStatus,
  messageBlocks,
  messageTimes,
  normalizeSources,
  outputText,
  pendingApprovals,
  plainText,
  speechRate,
  type FileItem,
  type HistoryMessage,
  type ModelAction,
  type ReplyAnnotation,
} from '@maviechat/owui-protocol';
import { Image } from 'expo-image';
import { memo, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { MenuButton, type MenuItem } from '@/components/Menu';
import { ReadAloudButton } from '@/components/ReadAloudButton';
import { SideScroll } from '@/components/SideScroll';
import { useToast } from '@/components/Toast';
import { showPrompt } from '@/components/dialogs';
import { useCapabilities, useUserSettings } from '@/lib/server';
import { copyReply } from '@/lib/copy';
import { useInterface } from '@/lib/uiSettings';
import { useStoredState } from '@/lib/storedState';
import { Markdown } from '@/markdown/Markdown';
import { fonts, radius, usePalette } from '@/theme';
import { ApprovalCard } from './ApprovalCard';
import { BranchNav } from './BranchNav';
import { EmbedFrame } from './EmbedFrame';
import { RatePanel } from './RatePanel';
import { SelectTextSheet } from './SelectTextSheet';
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
  onEdit,
  onRate,
  onContinue,
  actions = [],
  onAction,
  onApprove,
  onQuote,
  onInsert,
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
  /** Opens the reply in the editor (Save, or Save As Copy). */
  onEdit?: () => void;
  /** 👍/👎, or the rating panel's details; resolves true once saved. */
  onRate?: (change: { rating?: 1 | -1; details?: Partial<ReplyAnnotation> }) => Promise<boolean>;
  /** "Continue Response" (the last reply only). */
  onContinue?: () => void;
  /** The model's action buttons. */
  actions?: ModelAction[];
  onAction?: (action: ModelAction) => void;
  /** Allow or deny a tool call waiting for your OK; absent where it can't be answered (temporary chats). */
  onApprove?: (callId: string, approve: boolean) => Promise<void>;
  /** Puts a prompt in the message box (Select Text's Ask, Explain and your own actions). */
  onQuote?: (prompt: string) => void;
  /** A note's chat: puts this reply's text into the note (the web's Insert). */
  onInsert?: () => void;
}) {
  const palette = usePalette();
  const toast = useToast();
  const times = messageTimes(message.timestamp);
  const capabilities = useCapabilities();
  const settings = useUserSettings();
  // Read Aloud follows the `chat.tts` permission (allowed unless denied) and your speed setting.
  const canSpeak = capabilities?.can('chat.tts', true) ?? false;
  const ttsRate = speechRate(settings.data?.ui);
  const ui = useInterface();
  const [revealed, setRevealed] = useState(false);
  // Kept by message (the list reuses rows as you scroll).
  const [rating, setRating] = useStoredState<boolean>(`rate-panel:${message.id}`, false);
  const [selecting, setSelecting] = useState(false);
  const annotation = (message.annotation as ReplyAnnotation | undefined) ?? {};
  const blocks = useMemo(() => messageBlocks(message), [message]);
  const items = useMemo(() => groupSteps(blocks), [blocks]);
  const lastTextId = useMemo(() => [...items].reverse().find((item) => item.kind === 'text')?.id, [items]);
  const sources = useMemo(() => normalizeSources(message.sources), [message.sources]);
  const status = latestStatus(message.statusHistory);
  const error = errorText(message.error);
  const approvals = useMemo(() => pendingApprovals(message), [message]);
  // Web content a tool sent for the reply as a whole (tools run the web's default way).
  const embeds = useMemo(() => embedList(message.embeds), [message.embeds]);
  // Stopped for your approval or answer: not being written any more.
  const streaming = message.done === false && !awaitingYou(message);
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
        {
          key: 'suggest',
          label: 'Suggest a change',
          icon: 'chat-bubble-bottom-center-text',
          onPress: () =>
            showPrompt('Suggest a change', undefined, [
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
    : [];

  return (
    <Pressable onPress={() => setRevealed((value) => !value)} style={styles.wrap} accessibilityHint="Shows message actions">
      <View style={styles.modelRow}>
        <Text style={[styles.model, { color: palette.text }]} numberOfLines={1}>
          {modelLabel}
        </Text>
        {/* When it was written, by the model's name as on the web; the whole date on a tap, where the web shows it on hover. */}
        {times ? (
          <Pressable accessibilityRole="button" accessibilityLabel={`Written ${times.full}`} hitSlop={8} onPress={() => toast(times.full)}>
            <Text style={[styles.time, { color: palette.textFaint }]}>{times.short}</Text>
          </Pressable>
        ) : null}
      </View>

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
          ui('renderMarkdownInAssistantMessages') ? (
            <Markdown
              key={item.id}
              text={item.text}
              sources={sources}
              baseUrl={baseUrl}
              token={token}
              foldCode={ui('collapseCodeBlocks')}
              // New words fade in at the end of what's being written (the web's default).
              fadeIn={streaming && item.id === lastTextId && ui('chatFadeStreamingText')}
            />
          ) : (
            <Text key={item.id} selectable style={[styles.plain, { color: palette.text }]}>
              {item.text}
            </Text>
          )
        ) : item.kind === 'group' ? (
          <StepGroup key={item.id} item={item} open={ui('expandDetails')} />
        ) : (
          <StepView key={item.id} step={item} open={ui('expandDetails')} />
        ),
      )}

      {embeds.length ? (
        <View style={styles.embeds}>
          {embeds.map((embed, index) => (
            <EmbedFrame key={index} embed={embed} />
          ))}
        </View>
      ) : null}

      {approvals.map((call) => (
        <ApprovalCard key={call.callId} call={call} onDecide={onApprove ? (approve) => onApprove(call.callId, approve) : undefined} />
      ))}

      {streaming && items.length === 0 && !status ? <ActivityIndicator style={styles.pending} color={palette.textMuted} /> : null}

      {error ? (
        <View style={[styles.error, { borderColor: palette.danger }]}>
          <Icon name="exclamation-triangle" size={16} color={palette.danger} />
          <Text style={[styles.errorText, { color: palette.danger }]}>{error}</Text>
        </View>
      ) : null}

      <Sources sources={sources} />

      {(isLast || ui('keepFollowUpPrompts')) && !streaming && onFollowUp && (message.followUps?.length ?? 0) > 0 ? (
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
        // The web's order; on a narrow phone the row scrolls sideways.
        <SideScroll showsHorizontalScrollIndicator={false} style={styles.actionsScroll} contentContainerStyle={styles.actions}>
          <BranchNav index={branch.index} count={branch.count} onStep={onStep} />
          {onInsert ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Insert into note" hitSlop={4} onPress={onInsert} style={[styles.insert, { borderColor: palette.border }]}>
              <Icon name="document-text" size={15} color={palette.textMuted} />
              <Text style={[styles.insertText, { color: palette.textMuted }]}>Insert</Text>
            </Pressable>
          ) : null}
          {onEdit ? <IconButton icon="pencil" label="Edit" size={18} color={palette.textMuted} onPress={onEdit} /> : null}
          <IconButton
            icon="clipboard-document"
            label="Copy response"
            size={18}
            color={palette.textMuted}
            onPress={() => void copyReply(plainText(blocks), ui('copyFormatted')).then(() => toast('Copied to clipboard'))}
          />
          {onQuote ? <IconButton icon="cursor-arrow-rays" label="Select Text" size={18} color={palette.textMuted} onPress={() => setSelecting(true)} /> : null}
          {canSpeak ? <ReadAloudButton id={message.id} markdown={outputText(message.output) || message.content || ''} rate={ttsRate} /> : null}
          {usage ? (
            <IconButton
              icon="information-circle"
              label="Usage"
              size={18}
              color={palette.textMuted}
              onPress={() => Alert.alert('Usage', usage)}
            />
          ) : null}
          {onRate ? (
            <>
              <IconButton
                icon="hand-thumb-up"
                label={annotation.rating === 1 ? 'Good response (rated)' : 'Good response'}
                size={18}
                color={annotation.rating === 1 ? palette.text : palette.textMuted}
                onPress={() => {
                  setRating(true);
                  void onRate({ rating: 1 });
                }}
              />
              <IconButton
                icon="hand-thumb-down"
                label={annotation.rating === -1 ? 'Bad response (rated)' : 'Bad response'}
                size={18}
                color={annotation.rating === -1 ? palette.text : palette.textMuted}
                onPress={() => {
                  setRating(true);
                  void onRate({ rating: -1 });
                }}
              />
            </>
          ) : null}
          {isLast && onContinue ? <IconButton icon="play" label="Continue response" size={18} color={palette.textMuted} onPress={onContinue} /> : null}
          {onRegenerate && !ui('regenerateMenu') ? (
            <IconButton icon="arrow-path" label="Regenerate" size={18} color={palette.textMuted} onPress={() => onRegenerate()} />
          ) : regenerateItems.length > 0 ? (
            <MenuButton items={regenerateItems} label="Regenerate" icon="arrow-path" size={18} color={palette.textMuted} />
          ) : null}
          {onAction
            ? actions.map((action) => (
                <Pressable
                  key={action.id}
                  accessibilityRole="button"
                  accessibilityLabel={action.name ?? action.id}
                  hitSlop={4}
                  onPress={() => onAction(action)}
                  style={styles.actionButton}>
                  {action.icon ? (
                    <Image
                      source={{ uri: action.icon }}
                      style={styles.actionIcon}
                      tintColor={action.icon.includes('image/svg') ? palette.textMuted : undefined}
                      contentFit="contain"
                    />
                  ) : (
                    <Icon name="sparkles" size={18} color={palette.textMuted} />
                  )}
                </Pressable>
              ))
            : null}
          {onDelete ? <IconButton icon="trash" label="Delete" size={18} color={palette.textMuted} onPress={onDelete} /> : null}
        </SideScroll>
      ) : null}

      {onQuote ? <SelectTextSheet text={plainText(blocks)} visible={selecting} onClose={() => setSelecting(false)} onPrompt={onQuote} /> : null}

      {onRate && rating && annotation.rating && !streaming ? (
        <RatePanel annotation={annotation} onSave={(details) => onRate({ details })} onClose={() => setRating(false)} />
      ) : null}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  plain: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 24, marginVertical: 4 },
  wrap: { marginTop: 18 },
  modelRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginBottom: 4 },
  model: { flexShrink: 1, fontFamily: fonts.semibold, fontSize: 15 },
  time: { fontFamily: fonts.regular, fontSize: 11 },
  status: { flexDirection: 'row', alignItems: 'center', gap: 8, marginVertical: 4 },
  statusText: { flexShrink: 1, fontFamily: fonts.medium, fontSize: 14 },
  pending: { alignSelf: 'flex-start', marginVertical: 8 },
  embeds: { gap: 8, marginVertical: 6 },
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
  actionsScroll: { marginTop: 4, marginLeft: -8, marginRight: -16 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingRight: 16 },
  actionButton: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  insert: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 28, paddingHorizontal: 8, marginHorizontal: 4, borderWidth: StyleSheet.hairlineWidth, borderRadius: 14 },
  insertText: { fontFamily: fonts.medium, fontSize: 13 },
  actionIcon: { width: 18, height: 18 },
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
