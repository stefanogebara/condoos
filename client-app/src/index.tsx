import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import App from './App';
import './index.css';
import { initAnalytics } from './lib/analytics';

initAnalytics();

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);
root.render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
      <Toaster
        position="top-center"
        toastOptions={{
          style: {
            background: 'rgba(250, 246, 239, 0.7)',
            backdropFilter: 'blur(24px)',
            border: '1px solid rgba(255,255,255,0.4)',
            color: '#4A3A36',
            borderRadius: '18px',
            padding: '12px 18px',
            boxShadow: '0 12px 40px -8px rgba(40,30,25,0.22)',
          },
        }}
      />
    </BrowserRouter>
  </React.StrictMode>,
);
