import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { z } from 'zod';
import { App } from './App.tsx';
import { initTheme } from './lib/theme.ts';
import './styles/index.css';

// No `new Function` probe: the CSP has no 'unsafe-eval' and would report it as a violation.
z.config({ jitless: true });
initTheme();

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </StrictMode>,
  );
}
