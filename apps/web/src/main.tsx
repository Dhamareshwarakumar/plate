import '@fontsource-variable/inter';
import './styles/globals.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { registerPwa } from './pwa/register';

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// The service worker exists only in production builds (vite.config.ts devOptions.enabled = false).
if (import.meta.env.PROD) registerPwa();
