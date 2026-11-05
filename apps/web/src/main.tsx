import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';
import { startErrorReports } from './lib/errorReports';

createRoot(document.getElementById('root')!, startErrorReports()).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
