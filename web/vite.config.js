import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true, // Do not silently switch to 5174 and mask an old running instance.
    proxy: { '/api': 'http://127.0.0.1:3001' },
  },
});
