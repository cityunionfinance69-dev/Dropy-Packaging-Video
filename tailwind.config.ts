import type { Config } from 'tailwindcss';

// This file IS the design system — every color here maps to a decision, not to
// Tailwind's defaults. Components never write raw hex values; they reach for
// these names, so the palette shifts in exactly one place.
//
// LIGHT THEME. The surface ladder runs light-to-slightly-darker as things come
// FORWARD, which is the opposite of the dark theme's logic:
//   base    the page ground — a hair off pure white so panels can be white
//   panel   cards, table chrome, sidebar — pure white, sitting on the ground
//   raised  things ON a panel: hover rows, thumbnails, inputs, code
//
// Pure #FFF for the page would leave panels nowhere to go except grey, which
// reads as "disabled" rather than "elevated". Starting the ground at #F7F8FA
// keeps white available as the forward surface.
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        base: '#F7F8FA',
        panel: '#FFFFFF',
        raised: '#F2F4F7',
        border: '#E4E7EC',
        // For focused/interactive edges that need to read stronger than a
        // hairline without pulling in the accent color.
        'border-strong': '#CFD4DC',

        // Semantic accents. Each is dark enough for AA contrast on white —
        // the dark theme's neon teal (#5EEAD4) would be unreadable here, so
        // these are genuinely different colors, not the same ones dimmed.
        teal: '#067A6F', // success / delivered  (5.3:1 on white)
        amber: '#B54708', // warning / filling up (4.9:1 on white)
        red: '#B42318', // error / unmatched    (6.3:1 on white)
        violet: '#5925DC', // video / in-transit   (8.1:1 on white)
        accent: '#2563EB', // links, focus, primary action (5.2:1 on white)

        ink: '#101828', // primary text   (16.8:1 on white)
        muted: '#475467', // secondary text (8.9:1 on white)
        // #667085, not a lighter grey: `faint` carries real text (timestamps,
        // column labels, placeholders), and the obvious #98A2B3 measures only
        // 2.58:1 on white — below AA. This is 4.97:1 on white and 4.51:1 on
        // `raised`, so it stays legible on every surface it's used over.
        faint: '#667085' // tertiary — labels, timestamps, placeholders
      },
      fontFamily: {
        sans: ['var(--font-plex-sans)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-plex-mono)', 'ui-monospace', 'monospace']
      },
      // Real shadows, which a light UI needs and a dark one can't use: on dark
      // surfaces a shadow reads as mud, so the previous theme carried depth
      // purely by lightness. Here, elevation is what separates a card from the
      // page and a modal from the card.
      boxShadow: {
        card: '0 1px 2px 0 rgb(16 24 40 / 0.04), 0 1px 3px 0 rgb(16 24 40 / 0.06)',
        raised: '0 2px 4px -1px rgb(16 24 40 / 0.06), 0 4px 8px -2px rgb(16 24 40 / 0.08)',
        modal: '0 8px 16px -4px rgb(16 24 40 / 0.10), 0 24px 48px -12px rgb(16 24 40 / 0.18)'
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' }
        },
        'scale-in': {
          from: { opacity: '0', transform: 'scale(0.97)' },
          to: { opacity: '1', transform: 'scale(1)' }
        },
        pulse: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.45' }
        }
      },
      animation: {
        'fade-in': 'fade-in 120ms ease-out',
        'scale-in': 'scale-in 140ms cubic-bezier(0.2, 0.8, 0.2, 1)',
        pulse: 'pulse 1.6s ease-in-out infinite'
      }
    }
  },
  plugins: []
};
export default config;
