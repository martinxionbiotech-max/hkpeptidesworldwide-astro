// @ts-check
import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import cloudflare from '@astrojs/cloudflare';

// https://astro.build/config
export default defineConfig({
  integrations: [tailwind()],
  output: 'static',
  adapter: cloudflare({
    mode: 'directory',
    prerenderEnvironment: 'node',
  }),
  site: 'https://hkpeptidesworldwide.com',
  image: {
    service: { entrypoint: 'astro/assets/services/sharp' },
  },
});
