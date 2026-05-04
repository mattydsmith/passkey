import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 5173,
    host: "localhost",
    proxy: {
      "/auth": "http://localhost:3001",
      "/__test": "http://localhost:3001",
    },
  },
  resolve: { dedupe: ["@mattsmith/passkey-sdk-client-web"] },
});
