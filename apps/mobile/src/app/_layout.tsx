import { Inter_400Regular } from '@expo-google-fonts/inter/400Regular';
import { Inter_500Medium } from '@expo-google-fonts/inter/500Medium';
import { Inter_600SemiBold } from '@expo-google-fonts/inter/600SemiBold';
import { JetBrainsMono_400Regular } from '@expo-google-fonts/jetbrains-mono/400Regular';
import { DtHttpError } from '@maviechat/deeptutor-protocol';
import { OwuiHttpError } from '@maviechat/owui-protocol';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { Platform, StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { DialogHost } from '@/components/DialogHost';
import { ToastProvider } from '@/components/Toast';
import { prepareLaunchSpace } from '@/features/deeptutor/launch';
import { NotificationRoot } from '@/features/notifications/NotificationRoot';
import { UpdatePrompt } from '@/features/updates/UpdatePrompt';
import { DeepTutorProvider } from '@/session/DeepTutorProvider';
import { OpenCodeProvider } from '@/session/OpenCodeProvider';
import { SessionProvider } from '@/session/SessionProvider';
import { usePalette } from '@/theme';
import { loadThemePreference } from '@/theme/preference';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // Client errors (expired token, missing permission) won't fix themselves on retry.
      retry: (failureCount, error) =>
        !((error instanceof OwuiHttpError || error instanceof DtHttpError) && error.status < 500) && failureCount < 2,
    },
  },
});

export default function RootLayout() {
  const palette = usePalette();
  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    JetBrainsMono_400Regular,
  });

  // The saved theme is applied before the first frame, so a dark-theme user never sees a light flash.
  const [themeReady, setThemeReady] = useState(false);
  useEffect(() => {
    // The space open last is read now too, so a launch opens straight into it.
    void Promise.all([loadThemePreference(), prepareLaunchSpace()]).finally(() => setThemeReady(true));
  }, []);

  if (!fontsLoaded || !themeReady) return null;

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <KeyboardProvider>
          <QueryClientProvider client={queryClient}>
            <ToastProvider>
              <SessionProvider>
                <DeepTutorProvider>
                  <OpenCodeProvider>
                    <StatusBar style="auto" />
                    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: palette.background } }} />
                    <NotificationRoot />
                    <UpdatePrompt />
                    {Platform.OS === 'android' ? <DialogHost /> : null}
                  </OpenCodeProvider>
                </DeepTutorProvider>
              </SessionProvider>
            </ToastProvider>
          </QueryClientProvider>
        </KeyboardProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
