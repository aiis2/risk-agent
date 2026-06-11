/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: 'rgb(var(--surface-bg) / <alpha-value>)',
          card: 'rgb(var(--surface-card) / <alpha-value>)',
          soft: 'rgb(var(--surface-soft) / <alpha-value>)',
          hover: 'rgb(var(--surface-hover) / <alpha-value>)',
          sidebar: 'rgb(var(--surface-sidebar) / <alpha-value>)',
          input: 'rgb(var(--surface-input) / <alpha-value>)',
          dialog: 'rgb(var(--surface-dialog) / <alpha-value>)',
        },
        border: {
          DEFAULT: 'rgb(var(--border-default) / <alpha-value>)',
          subtle: 'rgb(var(--border-subtle) / <alpha-value>)',
          strong: 'rgb(var(--border-strong) / <alpha-value>)',
        },
        text: {
          DEFAULT: 'rgb(var(--text-primary) / <alpha-value>)',
          dim: 'rgb(var(--text-dim) / <alpha-value>)',
          muted: 'rgb(var(--text-muted) / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'rgb(var(--accent) / <alpha-value>)',
          hover: 'rgb(var(--accent-hover) / <alpha-value>)',
        },
        success: { DEFAULT: 'rgb(var(--success) / <alpha-value>)' },
        warn: { DEFAULT: 'rgb(var(--warn) / <alpha-value>)' },
        danger: { DEFAULT: 'rgb(var(--danger) / <alpha-value>)' },
        node: {
          cyan: 'rgb(var(--node-cyan) / <alpha-value>)',
          purple: 'rgb(var(--node-purple) / <alpha-value>)',
          lavender: 'rgb(var(--node-lavender) / <alpha-value>)',
          mint: 'rgb(var(--node-mint) / <alpha-value>)',
        },
        cli: {
          DEFAULT: 'rgb(var(--cli-shell-bg) / <alpha-value>)',
          overlay: 'rgb(var(--cli-shell-overlay) / <alpha-value>)',
          header: 'rgb(var(--cli-header-bg) / <alpha-value>)',
          subbar: 'rgb(var(--cli-subbar-bg) / <alpha-value>)',
          terminal: 'rgb(var(--cli-terminal-bg) / <alpha-value>)',
          border: 'rgb(var(--cli-shell-border) / <alpha-value>)',
        },
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', '"PingFang SC"', '"Microsoft YaHei"', 'sans-serif'],
        mono: ['"SF Mono"', 'Menlo', 'Consolas', 'monospace'],
      },
      borderRadius: {
        DEFAULT: '10px',
      },
      animation: {
        'fade-in': 'fadeIn 0.2s ease-out',
        'slide-in': 'slideIn 0.2s ease-out',
        'pulse-soft': 'pulseSoft 2s ease-in-out infinite',
      },
      keyframes: {
        fadeIn: {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        slideIn: {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        pulseSoft: {
          '0%, 100%': { opacity: '0.7' },
          '50%': { opacity: '1' },
        },
      },
    },
  },
  plugins: [
    require('tailwindcss-animate'),
  ],
};
