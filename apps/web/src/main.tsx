import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { z } from 'zod';
import { App } from './App.tsx';
import { ErrorBoundary, reloadOnceForMissingFile } from './components/ErrorBoundary.tsx';
import { initBranding, initTemplate } from './lib/branding.ts';
import { initTheme } from './lib/theme.ts';
import './styles/index.css';

// No `new Function` probe: the CSP has no 'unsafe-eval' and would report it as a violation.
z.config({ jitless: true });
initTheme();
// Template of the last visit (dark theme, fonts) before the first render: no flash of the standard look.
initTemplate();
// Graphics of the client of the hostname: the page renders at once with the defaults, the colours follow.
void initBranding();

// A file of an older version of the portal is gone (published while the tab was open): reload once, never loop.
window.addEventListener('vite:preloadError', (event) => {
  if (reloadOnceForMissingFile()) event.preventDefault();
});

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <BrowserRouter>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </BrowserRouter>
    </StrictMode>,
  );
}
