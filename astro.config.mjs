import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import vercel from '@astrojs/vercel';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig({
  output: 'server',
  devToolbar: { enabled: false },
  adapter: vercel(),
  integrations: [react()],
  security: { checkOrigin: true },
  vite: { plugins: [tailwindcss()] },
});
