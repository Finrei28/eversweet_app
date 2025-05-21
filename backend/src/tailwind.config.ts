import { type Config } from "tailwindcss"

/** @type {import('tailwindcss').Config} */
export default {
  content: ["./**/*.tsx", "./**/*.ts", "./**/*.jsx", "./**/*.js"],
  theme: {
    extend: {
      borderRadius: {
        lg: "0.5rem", // var(--radius)
        md: "calc(0.5rem - 2px)",
        sm: "calc(0.5rem - 4px)",
      },
      colors: {
        // Light mode
        background: "#fcf8f3", // hsl(33.3 100% 96.5%)
        foreground: "#0a0a0a", // hsl(0 0% 3.9%)

        card: {
          DEFAULT: "#ffffff", // hsl(0 0% 100%)
          foreground: "#0a0a0a",
        },
        popover: {
          DEFAULT: "#ffffff",
          foreground: "#0a0a0a",
        },
        primary: {
          DEFAULT: "#e6aa6b", // hsl(28, 66%, 70%)
          foreground: "#fafafa", // hsl(0 0% 98%)
        },
        secondary: {
          DEFAULT: "#f9e1b9", // hsl(30.65, 83%, 83.25%)
          foreground: "#171717", // hsl(0 0% 9%)
        },
        muted: {
          DEFAULT: "#f5f5f5", // hsl(0 0% 96.1%)
          foreground: "#737373", // hsl(0 0% 45.1%)
        },
        accent: {
          DEFAULT: "#f5f5f5",
          foreground: "#171717",
        },
        destructive: {
          DEFAULT: "#ef4444", // hsl(0 84.2% 60.2%)
          foreground: "#fafafa",
        },
        border: "#e5e5e5", // hsl(0 0% 89.8%)
        input: "#e5e5e5", // same as border
        ring: "#0a0a0a", // hsl(0 0% 3.9%)

        chart: {
          1: "#f28c28", // hsl(12 76% 61%)
          2: "#339b8b", // hsl(173 58% 39%)
          3: "#3c5264", // hsl(197 37% 24%)
          4: "#f5c066", // hsl(43 74% 66%)
          5: "#f8a64e", // hsl(27 87% 67%)
        },

        // Dark mode (optional for manual theme switching)
        dark: {
          background: "#0a0a0a",
          foreground: "#fafafa",
          card: {
            DEFAULT: "#0a0a0a",
            foreground: "#fafafa",
          },
          popover: {
            DEFAULT: "#0a0a0a",
            foreground: "#fafafa",
          },
          primary: {
            DEFAULT: "#fafafa",
            foreground: "#171717",
          },
          secondary: {
            DEFAULT: "#262626",
            foreground: "#fafafa",
          },
          muted: {
            DEFAULT: "#262626",
            foreground: "#a3a3a3",
          },
          accent: {
            DEFAULT: "#262626",
            foreground: "#fafafa",
          },
          destructive: {
            DEFAULT: "#7f1d1d", // hsl(0 62.8% 30.6%)
            foreground: "#fafafa",
          },
          border: "#262626",
          input: "#262626",
          ring: "#d4d4d4", // hsl(0 0% 83.1%)
          chart: {
            1: "#3b82f6", // hsl(220 70% 50%)
            2: "#10b981", // hsl(160 60% 45%)
            3: "#f59e0b", // hsl(30 80% 55%)
            4: "#c084fc", // hsl(280 65% 60%)
            5: "#ec4899", // hsl(340 75% 55%)
          },
        },
      },
    },
  },
  plugins: [],
} satisfies Config
