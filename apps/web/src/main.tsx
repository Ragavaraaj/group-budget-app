import './lib/zod-config'; // must stay first: configures zod before any schema is built
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { registerPwa } from './pwa/register';
import './styles/globals.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// After the first render so the toast container exists when update/offline toasts fire.
registerPwa();
