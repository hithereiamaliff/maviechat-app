import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Animated, Pressable, StyleSheet, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fonts, radius, usePalette } from '@/theme';

type Tone = 'info' | 'error' | 'success';

/** A button on the toast, such as "Restart". */
export interface ToastAction {
  label: string;
  onPress(): void;
}

type ShowToast = (message: string, tone?: Tone, action?: ToastAction) => void;

interface ToastState {
  id: number;
  message: string;
  tone: Tone;
  action?: ToastAction;
}

const ToastContext = createContext<ShowToast | null>(null);

/** Short messages at the top of the screen, like the web app's toasts. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const [toast, setToast] = useState<ToastState | null>(null);
  const [opacity] = useState(() => new Animated.Value(0));
  const counter = useRef(0);

  const show = useCallback((message: string, tone: Tone = 'info', action?: ToastAction) => {
    counter.current += 1;
    setToast({ id: counter.current, message, tone, action });
  }, []);

  useEffect(() => {
    if (!toast) return;
    Animated.timing(opacity, { toValue: 1, duration: 150, useNativeDriver: true }).start();
    const timer = setTimeout(() => {
      Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: true }).start(() =>
        setToast((current) => (current?.id === toast.id ? null : current)),
      );
    }, toast.action ? 8000 : 3200);
    return () => clearTimeout(timer);
  }, [toast, opacity]);

  const value = useMemo(() => show, [show]);
  const accent = toast?.tone === 'error' ? palette.danger : toast?.tone === 'success' ? palette.success : palette.text;

  return (
    <ToastContext.Provider value={value}>
      {children}
      {toast ? (
        <Animated.View pointerEvents="box-none" style={[styles.wrap, { top: insets.top + 8, opacity }]}>
          <Pressable
            accessibilityRole="alert"
            onPress={() => setToast(null)}
            style={[styles.toast, toast.action && styles.withAction, { backgroundColor: palette.menu, borderColor: palette.border, shadowColor: '#000' }]}>
            <Text style={[styles.text, toast.action && styles.flexText, { color: accent }]}>{toast.message}</Text>
            {toast.action ? (
              <Pressable
                accessibilityRole="button"
                hitSlop={10}
                onPress={() => {
                  setToast(null);
                  toast.action?.onPress();
                }}>
                <Text style={[styles.text, styles.action, { color: palette.link }]}>{toast.action.label}</Text>
              </Pressable>
            ) : null}
          </Pressable>
        </Animated.View>
      ) : null}
    </ToastContext.Provider>
  );
}

export function useToast(): ShowToast {
  const show = useContext(ToastContext);
  if (!show) throw new Error('useToast must be used inside ToastProvider');
  return show;
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 16,
    right: 16,
    alignItems: 'center',
  },
  toast: {
    maxWidth: 480,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  text: {
    fontFamily: fonts.medium,
    fontSize: 14,
    lineHeight: 20,
  },
  withAction: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  flexText: { flexShrink: 1 },
  action: { fontFamily: fonts.semibold },
});
