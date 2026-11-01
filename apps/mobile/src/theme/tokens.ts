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

/** Sidebar width on phones: the web app's 245 px, widened slightly for touch. */
export const SIDEBAR_WIDTH = 270;

export interface Palette {
  background: string;
  surface: string;
  surfaceStrong: string;
  border: string;
  text: string;
  textMuted: string;
  textFaint: string;
  primary: string;
  onPrimary: string;
  danger: string;
  success: string;
  warning: string;
  /** Sidebar panel and the highlighted (current) row in it. */
  sidebar: string;
  sidebarActive: string;
  /** User message bubble. */
  bubble: string;
  link: string;
  codeBackground: string;
  codeHeader: string;
  overlay: string;
  menu: string;
  unread: string;
  /** A switched-on input toggle (web search, image, code interpreter). */
  active: string;
  onActive: string;
}

export const light: Palette = {
  background: '#FFFFFF',
  surface: gray[50],
  surfaceStrong: gray[100],
  border: gray[100],
  text: gray[900],
  textMuted: gray[600],
  textFaint: gray[500],
  primary: gray[900],
  onPrimary: '#FFFFFF',
  danger: '#DC2626',
  success: '#16A34A',
  warning: '#B45309',
  sidebar: gray[50],
  sidebarActive: gray[100],
  bubble: gray[50],
  link: '#2563EB',
  codeBackground: gray[50],
  codeHeader: gray[100],
  overlay: 'rgba(0, 0, 0, 0.4)',
  menu: '#FFFFFF',
  unread: '#0EA5E9',
  active: '#E0F2FE',
  onActive: '#0284C7',
};

export const dark: Palette = {
  background: gray[900],
  surface: gray[850],
  surfaceStrong: gray[800],
  border: gray[800],
  text: gray[100],
  textMuted: gray[400],
  textFaint: gray[500],
  primary: gray[100],
  onPrimary: gray[900],
  danger: '#F87171',
  success: '#4ADE80',
  warning: '#FBBF24',
  sidebar: gray[950],
  sidebarActive: gray[900],
  bubble: gray[850],
  link: '#60A5FA',
  codeBackground: gray[950],
  codeHeader: gray[850],
  overlay: 'rgba(0, 0, 0, 0.6)',
  menu: gray[850],
  unread: '#38BDF8',
  active: 'rgba(56, 189, 248, 0.16)',
  onActive: '#7DD3FC',
};

/** Dark with true-black surfaces, for OLED screens (the web's "OLED Dark" theme). */
export const oled: Palette = {
  ...dark,
  background: '#000000',
  surface: gray[950],
  surfaceStrong: gray[900],
  border: gray[900],
  sidebar: '#000000',
  sidebarActive: gray[950],
  bubble: gray[900],
  codeBackground: '#000000',
  codeHeader: gray[950],
  menu: gray[950],
  overlay: 'rgba(0, 0, 0, 0.7)',
};

/** Code colours by highlight.js scope (GitHub's Primer palette, MIT). */
export type SyntaxColors = Record<string, string>;

export const syntaxLight: SyntaxColors = {
  keyword: '#CF222E',
  built_in: '#953800',
  type: '#953800',
  literal: '#0550AE',
  number: '#0550AE',
  string: '#0A3069',
  regexp: '#0A3069',
  comment: '#6E7781',
  meta: '#6E7781',
  title: '#8250DF',
  'title.function': '#8250DF',
  'title.class': '#953800',
  attr: '#0550AE',
  attribute: '#0550AE',
  variable: '#953800',
  params: '#24292F',
  tag: '#116329',
  name: '#116329',
  symbol: '#0550AE',
  'selector-tag': '#116329',
  'selector-class': '#6639BA',
  addition: '#116329',
  deletion: '#82071E',
};

export const syntaxDark: SyntaxColors = {
  keyword: '#FF7B72',
  built_in: '#FFA657',
  type: '#FFA657',
  literal: '#79C0FF',
  number: '#79C0FF',
  string: '#A5D6FF',
  regexp: '#A5D6FF',
  comment: '#8B949E',
  meta: '#8B949E',
  title: '#D2A8FF',
  'title.function': '#D2A8FF',
  'title.class': '#FFA657',
  attr: '#79C0FF',
  attribute: '#79C0FF',
  variable: '#FFA657',
  params: '#C9D1D9',
  tag: '#7EE787',
  name: '#7EE787',
  symbol: '#79C0FF',
  'selector-tag': '#7EE787',
  'selector-class': '#D2A8FF',
  addition: '#7EE787',
  deletion: '#FFA198',
};
