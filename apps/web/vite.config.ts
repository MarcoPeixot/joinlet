import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { sourceStampPlugin } from './build/sourceStamp.mjs';
import { documentationPlugin } from './docs/site.mjs';

export default defineConfig({
  plugins: [react(), tailwindcss(), documentationPlugin(), sourceStampPlugin(new URL('../..', import.meta.url).href)],
  // The AI proxy (apps/server) keeps the API key; the browser only ever calls /api on this origin.
  // Target 127.0.0.1 (not localhost) so the proxy never depends on IPv4/IPv6 resolution order; changeOrigin
  // stays false (default) so the forwarded Host is localhost:5178, which the server's Host check accepts.
  build: {
    modulePreload: { polyfill: false },
    rollupOptions: {
      input: { landing: 'index.html', app: 'app/index.html', setup: 'setup/index.html' },
      output: {
        // Stable vendor chunks: better long-term caching and a lean entry. Yjs and DOMPurify are not listed
        // on purpose; they stay in the lazy chunks that import them.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'react';
          if (/[\\/]node_modules[\\/]@radix-ui[\\/]/.test(id)) return 'radix';
          if (/[\\/]node_modules[\\/](@codemirror|@lezer|codemirror|crelt|style-mod|w3c-keyname)[\\/]/.test(id)) return 'codemirror';
          if (/[\\/]node_modules[\\/](@xyflow|zustand|d3-[a-z-]+|classcat)[\\/]/.test(id)) return 'xyflow';
          return undefined;
        },
      },
    },
  },
  // `cors: false`: Vite's default answers preflights (and adds Allow-Origin) for any *.localhost origin, which would let
  // a page on http://x.localhost:3000 read the owner's API through this proxy. The app is same-origin, so it needs none.
  // `strictPort`: the owner's API only accepts the app's own origin (5178 dev, 4173 preview; STRUKT_ALLOWED_ORIGINS
  // adds others), so a silent fallback to 5179 would break every /api call.
  server: { port: 5178, strictPort: true, cors: false, proxy: { '/api': { target: 'http://127.0.0.1:8787', ws: true } } },
  preview: { port: 4173, cors: false },
});
