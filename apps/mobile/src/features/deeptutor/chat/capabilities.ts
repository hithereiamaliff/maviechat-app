import type { IconName } from '@/components/Icon';

/** A setting a mode offers in the composer, with our names for its values. */
export interface ModeOption {
  key: string;
  label: string;
  choices: { value: string | number; label: string }[];
}

interface ModeInfo {
  name: string;
  icon: IconName;
  /** Our own one-line description. */
  hint: string;
  /** What a turn sends unless you change it. */
  defaults: Record<string, unknown>;
  options: ModeOption[];
}

/** DeepTutor's modes ("capabilities") the app answers natively, in menu order. */
const MODES: Record<string, ModeInfo> = {
  chat: { name: 'Chat', icon: 'chat-bubble-left', hint: 'Talk it through, with the tools you switch on.', defaults: {}, options: [] },
  deep_solve: { name: 'Solve', icon: 'light-bulb', hint: 'Works a problem out step by step, then checks it.', defaults: {}, options: [] },
  deep_question: {
    name: 'Quiz',
    icon: 'academic-cap',
    hint: 'Writes questions on a topic for you to answer here.',
    defaults: { num_questions: 3, difficulty: '' },
    options: [
      { key: 'num_questions', label: 'Questions', choices: [1, 3, 5, 10].map((value) => ({ value, label: String(value) })) },
      {
        key: 'difficulty',
        label: 'Difficulty',
        choices: [
          { value: '', label: 'Any' },
          { value: 'easy', label: 'Easy' },
          { value: 'medium', label: 'Medium' },
          { value: 'hard', label: 'Hard' },
        ],
      },
    ],
  },
  deep_research: {
    name: 'Research',
    icon: 'globe-alt',
    hint: 'Plans an outline for you to confirm, then researches each part.',
    defaults: { mode: 'report', depth: 'quick' },
    options: [
      {
        key: 'depth',
        label: 'Depth',
        choices: [
          { value: 'quick', label: 'Quick' },
          { value: 'standard', label: 'Standard' },
          { value: 'deep', label: 'Deep' },
        ],
      },
      {
        key: 'mode',
        label: 'Write up as',
        choices: [
          { value: 'report', label: 'Report' },
          { value: 'notes', label: 'Notes' },
          { value: 'comparison', label: 'Comparison' },
          { value: 'learning_path', label: 'Learning path' },
        ],
      },
    ],
  },
  visualize: {
    name: 'Visualize',
    icon: 'chart-bar',
    hint: 'Draws a chart or diagram of what you describe.',
    defaults: { render_mode: 'auto', quality: 'medium' },
    options: [
      {
        key: 'quality',
        label: 'Quality',
        choices: [
          { value: 'low', label: 'Low' },
          { value: 'medium', label: 'Medium' },
          { value: 'high', label: 'High' },
        ],
      },
    ],
  },
  ask_questions: { name: 'Ask questions', icon: 'chat-bubble-bottom-center-text', hint: 'Asks you a few questions first, then answers.', defaults: {}, options: [] },
};

/** Names for the modes the app doesn't run natively (they open in the web app). */
const OTHER_NAMES: Record<string, string> = {
  math_animator: 'Math animation',
  video_lesson: 'Video lesson',
  audio_overview: 'Audio overview',
  immersive_reading: 'Reading',
  mastery_path: 'Mastery path',
};

export const NATIVE_MODES = Object.keys(MODES);

export function capabilityName(capability: string | undefined): string {
  if (!capability) return 'Chat';
  const known = MODES[capability]?.name ?? OTHER_NAMES[capability];
  if (known) return known;
  const words = capability.replace(/[_-]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Modes the app answers natively; the others keep working in DeepTutor's web app. */
export function isNativeCapability(capability: string | undefined): boolean {
  return !capability || capability in MODES;
}

export function modeInfo(capability: string): ModeInfo {
  return MODES[capability] ?? MODES.chat!;
}

/** The settings a turn in this mode sends: the mode's defaults with your choices on top, known keys only. */
export function modeConfig(capability: string, choices: Record<string, unknown> | undefined): Record<string, unknown> {
  const info = modeInfo(capability);
  const config: Record<string, unknown> = { ...info.defaults };
  for (const option of info.options) if (choices && option.key in choices) config[option.key] = choices[option.key];
  return config;
}
