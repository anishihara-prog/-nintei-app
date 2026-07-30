/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      spacing: {
        "5.5": "1.375rem", // w-5.5 / h-5.5 など元コードの中間サイズに対応
      },
    },
  },
  plugins: [],
};
