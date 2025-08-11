/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Core palette from your UI
        primary: {
          50:  "#EEF0FF",
          100: "#E7E9FF",
          200: "#D9DCFF",
          300: "#C5CAFF",
          400: "#A7B0FF",
          500: "#8E98FF",
          600: "#6B77F7", // accent used in chips/icons
          700: "#5964DA",
          800: "#464FB0",
          900: "#3B4392",
        },
        success: { 50:"#ECFDF5", 500:"#10B981", 600:"#059669" },
        danger:  { 50:"#FEF2F2", 500:"#EF4444", 600:"#DC2626" },
        page:    { bg:"#F7F8FC" },
        card:    { bg:"#FFFFFF", border:"#E5E7EB" },
      },
      boxShadow: {
        card: "0 1px 2px rgba(0,0,0,0.04), 0 8px 24px rgba(0,0,0,0.06)",
      },
      borderRadius: {
        xl: "0.875rem",
        "2xl": "1rem",
      },
    },
  },
  plugins: [],
}
