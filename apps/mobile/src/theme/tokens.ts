/**
 * MavieChat design tokens. The grey scale matches the neutral greys Open WebUI's
 * interface uses, recorded here as our own sRGB values; no Open WebUI code or
 * styles are copied (clean-room rule in AGENTS.md).
 */
export const gray = {
  50: '#F8F8F8',
  100: '#EBEBEB',
  200: '#E4E4E4',
  300: '#CECECE',
  400: '#B4B4B4',
  500: '#9B9B9B',
  600: '#666666',
  700: '#4D4D4D',
  800: '#333333',
  850: '#262626',
  900: '#161616',
  950: '#0D0D0D',
} as const;

/** Font family names as registered by `useFonts` in the root layout. */
export const fonts = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  mono: 'JetBrainsMono_400Regular',
} as const;

export const radius = { sm: 8, md: 12, lg: 16, xl: 24, full: 999 } as const;

export interface Palette {
  background: string;
  surface: string;
  surfaceStrong: string;
  border: string;
  text: string;
  textMuted: string;
  primary: string;
  onPrimary: string;
  danger: string;
  success: string;
  warning: string;
}

export const light: Palette = {
  background: '#FFFFFF',
  surface: gray[50],
  surfaceStrong: gray[100],
  border: gray[100],
  text: gray[900],
  textMuted: gray[600],
  primary: gray[900],
  onPrimary: '#FFFFFF',
  danger: '#DC2626',
  success: '#16A34A',
  warning: '#B45309',
};

export const dark: Palette = {
  background: gray[900],
  surface: gray[850],
  surfaceStrong: gray[800],
  border: gray[800],
  text: gray[100],
  textMuted: gray[400],
  primary: gray[100],
  onPrimary: gray[900],
  danger: '#F87171',
  success: '#4ADE80',
  warning: '#FBBF24',
};
