/** @type {import('tailwindcss').Config} */
const config = {
  content: [
    "./src/pages/**/*.{js,jsx}",
    "./src/components/**/*.{js,jsx}",
    "./src/app/**/*.{js,jsx}",
  ],
  theme: {
    extend: {
      colors: {
        // KitchFix Core Palette
        'kf-navy': '#0f3057',
        'kf-blue': '#2563eb',
        'kf-bg': '#f4f7f6',
        'kf-card': '#ffffff',
        'kf-border': '#e2e8f0',
        // Accent Colors
        'kf-mustard': '#fbbf24',
        'kf-purple': '#7c3aed',
        'kf-green': '#10b981',
        'kf-red': '#ef4444',
        'kf-orange': '#d97706',
        // Status Colors
        'status-pending': '#fbbf24',
        'status-success': '#10b981',
        'status-action': '#ef4444',
      },
      fontFamily: {
        mulish: ['Mulish', 'sans-serif'],
        inter: ['Inter', 'sans-serif'],
      },
      borderRadius: {
        'kf': '12px',
        'pill': '50px',
      },
      boxShadow: {
        'kf': '0 4px 6px 1px rgba(0,0,0,0.06)',
        'kf-hover': '0 8px 20px rgba(0,0,0,0.08)',
        'porcelain': '0 2px 5px rgba(0,0,0,0.04), 0 10px 20px rgba(0,0,0,0.03)',
      },
      maxWidth: {
        'kf': '1024px',
      },
      keyframes: {
        shake: {
          '0%, 100%': { transform: 'translateX(0)' },
          '25%': { transform: 'translateX(-6px)' },
          '75%': { transform: 'translateX(6px)' },
        },
        breathe: {
          '0%, 100%': { transform: 'scale(1)' },
          '50%': { transform: 'scale(1.05)' },
        },
        fadeIn: {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        shake: 'shake 0.4s ease-in-out',
        breathe: 'breathe 3s ease-in-out infinite',
        fadeIn: 'fadeIn 0.4s ease-out forwards',
      },
    },
  },
  plugins: [],
};

export default config;