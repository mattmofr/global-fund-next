import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5175,
    proxy: {
      "/socket.io": { target: "http://127.0.0.1:3102", ws: true },
      "/health": "http://127.0.0.1:3102",
    },
  },
  build: { chunkSizeWarningLimit: 1500 },
});
