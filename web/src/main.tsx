import { createRoot } from 'react-dom/client';
import { App } from './App';
import { AccessGate } from './components/AccessGate';
import './styles/index.css';

// iOS Safari viewport fix: set --vh to actual visible height
// This accounts for Safari's URL bar and home indicator
function setViewportHeight() {
  const vh = window.visualViewport?.height ?? window.innerHeight;
  document.documentElement.style.setProperty('--vh', `${vh}px`);
}

setViewportHeight();
window.visualViewport?.addEventListener('resize', setViewportHeight);
window.addEventListener('resize', setViewportHeight);

createRoot(document.getElementById('root')!).render(
  <AccessGate>
    <App />
  </AccessGate>
);
