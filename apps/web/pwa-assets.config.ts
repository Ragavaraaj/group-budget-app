import { defineConfig } from '@vite-pwa/assets-generator/config';

// `npm run icons -w @budget/web` regenerates every icon in public/ from public/logo.svg.
// The source is a full-bleed square with its artwork inside the maskable safe zone, so one
// image serves the regular, maskable and Apple icons (padding stays 0).
export default defineConfig({
  preset: {
    transparent: { sizes: [64, 192, 512], favicons: [[48, 'favicon.ico']], padding: 0 },
    maskable: { sizes: [512] },
    apple: { sizes: [180] },
  },
  images: ['public/logo.svg'],
});
