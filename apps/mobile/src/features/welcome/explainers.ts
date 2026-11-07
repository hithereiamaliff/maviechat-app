import { DEVICE } from '@/lib/device';
/** A welcome-screen explainer: what something is, in plain words, and what to do next. */
export interface Explainer {
  title: string;
  intro: string;
  sections: { heading: string; text?: string; bullets?: string[] }[];
  /** Guides elsewhere (they open in the in-app browser). */
  links?: { label: string; url: string }[];
  /** The sign-in this explainer leads to. */
  action?: { label: string; route: '/login' | '/deeptutor-login' | '/pair' };
}

export type ExplainerKey = 'owui' | 'deeptutor' | 'opencode' | 'no-server';

/** Our own words about each product, for people choosing on a first launch. */
export const EXPLAINERS: Record<ExplainerKey, Explainer> = {
  owui: {
    title: 'What is Open WebUI?',
    intro:
      'Open WebUI is free, open-source software for chatting with AI. It runs on a server that you, your organisation or someone you know looks after, and it works much like ChatGPT.',
    sections: [
      {
        heading: 'Good for',
        bullets: [
          'Everyday chat with the AI models the server offers, from providers like OpenAI or models running on the server itself',
          'Attaching files and photos, searching the web and using tools, where the server allows it',
          'Keeping your chats on a server you trust, in folders, pinned or archived',
        ],
      },
      {
        heading: 'How it differs from DeepTutor',
        text: 'Open WebUI is general AI chat: it answers whatever you ask. DeepTutor is built for learning: it works through problems with you, tests you and keeps track of what you study.',
      },
      {
        heading: 'What you need',
        text: "The server's address (it looks like https://chat.example.com) and the email and password of your account there, from whoever runs the server.",
      },
    ],
    action: { label: 'Sign In to Open WebUI', route: '/login' },
  },
  deeptutor: {
    title: 'What is DeepTutor?',
    intro:
      "DeepTutor is a free, open-source AI tutor. Like Open WebUI it runs on a server that someone looks after, but it's built around learning rather than general chat.",
    sections: [
      {
        heading: 'Good for',
        bullets: [
          'Solving problems step by step, with each step checked',
          'Quizzes on any topic, marked as you answer',
          'Researching a topic into a report, and drawing charts and diagrams',
          'Learning activities, notes and your own study materials in one place',
        ],
      },
      {
        heading: 'How it differs from Open WebUI',
        text: 'Open WebUI answers whatever you ask, with whichever model you pick. DeepTutor teaches: it asks what you need, explains, quizzes you and remembers what you are learning.',
      },
      {
        heading: 'What you need',
        text: "The server's address and the username and password of your account there, from whoever runs the server.",
      },
    ],
    action: { label: 'Sign In to DeepTutor', route: '/deeptutor-login' },
  },
  opencode: {
    title: 'What is OpenCode?',
    intro:
      'OpenCode is a free, open-source coding agent. It runs on a computer or server where your code lives, reads your projects, and edits files and runs commands there when you ask it to.',
    sections: [
      {
        heading: 'Good for',
        bullets: [
          'Fixing bugs and adding features in your projects from your phone',
          'Seeing every command it runs and every file it changes as it works',
          'Approving or refusing each change before it happens',
          'Picking up sessions you started at the computer, and the other way round',
        ],
      },
      {
        heading: 'What you need',
        text: `A machine running OpenCode and the MavieChat gateway, which pairs this ${DEVICE} once with a link and only reaches the project folders you allow.`,
      },
    ],
    action: { label: 'Pair a Machine', route: '/pair' },
  },
  'no-server': {
    title: 'No server yet?',
    intro:
      "MavieChat doesn't run AI by itself. It connects to an Open WebUI or DeepTutor server that someone looks after, the way a mail app connects to an email account.",
    sections: [
      {
        heading: 'If someone gave you access',
        text: "For example your school, workplace or a friend. Ask them which one they run, the server's address and your sign-in, then pick it on the welcome screen. You can add the other one later.",
      },
      {
        heading: 'If no one has',
        text: 'Someone needs to set a server up first. It takes some technical know-how: a computer or cloud server that stays on, and access to AI models (an API key from a provider, or models running on that computer). Both projects have guides for whoever does it:',
      },
    ],
    links: [
      { label: 'Open WebUI: Getting Started', url: 'https://docs.openwebui.com/getting-started/' },
      { label: 'DeepTutor on GitHub', url: 'https://github.com/HKUDS/DeepTutor' },
    ],
  },
};
