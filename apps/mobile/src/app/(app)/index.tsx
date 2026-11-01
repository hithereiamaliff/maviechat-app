import { promptSuggestions } from '@maviechat/owui-protocol';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useToast } from '@/components/Toast';
import { ChatHeader } from '@/features/chat/ChatHeader';
import { Composer } from '@/features/chat/Composer';
import { ModelPicker } from '@/features/chat/ModelPicker';
import { useModelChoice } from '@/features/chat/useModelChoice';
import { useSendMessage } from '@/features/chat/useSendMessage';
import { useServerConfig, useSessionUser } from '@/lib/server';
import { fonts, radius, usePalette } from '@/theme';

/** New chat: the web app's default landing layout (model name, description, centred input, suggestions). */
export default function NewChat() {
  const palette = usePalette();
  const toast = useToast();
  const config = useServerConfig();
  const user = useSessionUser();
  const choice = useModelChoice(undefined);
  const { send } = useSendMessage();
  const [pickerOpen, setPickerOpen] = useState(false);

  const model = choice.model;
  const description = model?.info?.meta?.description;
  const suggestions = promptSuggestions(model, config.data).slice(0, 4);
  const firstName = user.data?.name?.split(/\s+/)[0];

  const start = async (text: string) => {
    if (!model) {
      toast(choice.loading ? 'Loading models…' : 'No model is available to this account.', 'error');
      return false;
    }
    const result = await send({ chatId: null, leafId: null, content: text, model });
    if (result) router.replace(`/c/${result.chatId}`);
    return Boolean(result);
  };

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      <ChatHeader />
      <KeyboardAvoidingView behavior="padding" style={styles.screen}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.greeting}>
            <Text style={[styles.title, { color: palette.text }]} numberOfLines={2}>
              {model?.name ?? (firstName ? `Hello, ${firstName}` : 'Hello')}
            </Text>
            {description ? (
              <Text style={[styles.description, { color: palette.textMuted }]} numberOfLines={3}>
                {description}
              </Text>
            ) : null}
          </View>

          <Composer
            floating
            modelLabel={model?.name ?? 'Select a model'}
            onPickModel={() => setPickerOpen(true)}
            onSend={start}
            onStop={() => {}}
            streaming={false}
          />

          {suggestions.length > 0 ? (
            <View style={styles.suggestions}>
              <Text style={[styles.suggestedLabel, { color: palette.textFaint }]}>Suggested</Text>
              {suggestions.map((suggestion, index) => (
                <Pressable
                  key={index}
                  accessibilityRole="button"
                  onPress={() => void start(suggestion.content)}
                  style={({ pressed }) => [styles.suggestion, { borderColor: palette.border }, pressed && { backgroundColor: palette.surface }]}>
                  <Text style={[styles.suggestionTitle, { color: palette.text }]} numberOfLines={1}>
                    {suggestion.title?.[0] ?? suggestion.content}
                  </Text>
                  {suggestion.title?.[1] ? (
                    <Text style={[styles.suggestionSub, { color: palette.textMuted }]} numberOfLines={1}>
                      {suggestion.title[1]}
                    </Text>
                  ) : null}
                </Pressable>
              ))}
            </View>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
      <ModelPicker
        visible={pickerOpen}
        models={choice.models}
        selectedId={model?.id ?? null}
        defaultId={choice.defaultId}
        onSelect={choice.pick}
        onClose={() => setPickerOpen(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { flexGrow: 1, justifyContent: 'center', paddingBottom: 48, gap: 20 },
  greeting: { paddingHorizontal: 24, gap: 8, alignItems: 'center' },
  title: { fontFamily: fonts.semibold, fontSize: 26, textAlign: 'center' },
  description: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 22, textAlign: 'center' },
  suggestions: { paddingHorizontal: 16, gap: 6 },
  suggestedLabel: { fontFamily: fonts.medium, fontSize: 13, paddingHorizontal: 4, marginBottom: 2 },
  suggestion: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg, paddingHorizontal: 14, paddingVertical: 10 },
  suggestionTitle: { fontFamily: fonts.medium, fontSize: 15 },
  suggestionSub: { fontFamily: fonts.regular, fontSize: 13, marginTop: 2 },
});
