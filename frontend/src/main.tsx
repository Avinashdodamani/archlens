import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';
import { configureAmplify } from './config/amplify';
import ErrorBoundary from './components/ErrorBoundary';

// Initialize AWS Amplify
configureAmplify();

// Apply the persisted theme (default: light / CloudThat) before first paint
// so there is no dark flash and the <html> dark class matches the store.
try {
  const persisted = localStorage.getItem('archlens-storage');
  const isDark = persisted ? JSON.parse(persisted)?.state?.darkMode === true : false;
  document.documentElement.classList.toggle('dark', isDark);
} catch {
  document.documentElement.classList.remove('dark');
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>
);
