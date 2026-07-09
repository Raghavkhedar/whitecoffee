import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        primary:    '#2F6DB0',  // blue accent
        background: '#FAF9F7',  // warm cream app background
        surface:    '#FFFFFF',
        border:     '#E7E3DE',  // warm hairline border
        'text-primary':   '#1A1613',
        'text-secondary': '#78716C',
        'accent-light':   '#EDF2FD',
        // shell
        sidebar:        '#1E232B',
        'sidebar-hover': 'rgba(255,255,255,.05)',
      },
      fontFamily: {
        sans: ['var(--font-geist-sans)', '-apple-system', 'system-ui', 'sans-serif'],
        mono: ['var(--font-geist-mono)', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
};

export default config;
