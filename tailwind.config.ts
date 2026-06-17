import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        primary:    '#1A5FAF',
        background: '#F0F4F8',
        surface:    '#FFFFFF',
        border:     '#C8D6E8',
        'text-primary':   '#0D1B2A',
        'text-secondary': '#6B7E94',
        'accent-light':   '#EBF2FB',
      },
    },
  },
  plugins: [],
};

export default config;
