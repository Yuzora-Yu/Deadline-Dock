import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  root: "web",
  base: "/tools/deadline-dock/",
  plugins: [react()],
  build: { outDir: "../dist-web", emptyOutDir: true, sourcemap: false },
  server: { host: "127.0.0.1", port: 1421, strictPort: true },
});
