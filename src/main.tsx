import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { initializeNetworkStatus } from './api/networkStatus';
import { App } from './App';
import './styles.css';

// Initialize network connectivity tracking once on app boot
initializeNetworkStatus();

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
