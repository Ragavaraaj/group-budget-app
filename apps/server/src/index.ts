import { createApp } from './app';

// The Worker's fetch handler. Wrangler serves the static web app for everything outside /api/*.
export default createApp();
