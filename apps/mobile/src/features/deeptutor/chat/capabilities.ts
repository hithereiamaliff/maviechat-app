/** Our names for DeepTutor's modes ("capabilities"); others show their id, made readable. */
const NAMES: Record<string, string> = {
  chat: 'Chat',
  deep_solve: 'Solve',
  deep_question: 'Quiz',
  deep_research: 'Research',
  visualize: 'Visualize',
  math_animator: 'Math animation',
  video_lesson: 'Video lesson',
  ask_questions: 'Ask questions',
  audio_overview: 'Audio overview',
  immersive_reading: 'Reading',
  mastery_path: 'Mastery path',
};

export function capabilityName(capability: string | undefined): string {
  if (!capability) return NAMES.chat ?? 'Chat';
  const known = NAMES[capability];
  if (known) return known;
  const words = capability.replace(/[_-]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Modes the app answers natively; the others keep working in DeepTutor's web app. */
export function isNativeCapability(capability: string | undefined): boolean {
  return !capability || capability === 'chat';
}
