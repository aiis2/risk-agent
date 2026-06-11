import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nextProvider } from 'react-i18next';
import { App } from './App';
import { ThemeProvider } from './components/ThemeProvider';
import { TooltipProvider } from './components/ui/Tooltip';
import { i18n } from './i18n';
import { initializeTheme } from './lib/theme';
import './styles/global.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      // Don't retry on network / connection-refused errors — avoids console flood when backend is offline
      retry: (_failureCount, error) => {
        const e = error as { response?: unknown };
        return Boolean(e.response); // only retry when server actually responded with an error status
      },
    },
  },
});

initializeTheme();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <TooltipProvider>
            <BrowserRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
              <App />
            </BrowserRouter>
          </TooltipProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </I18nextProvider>
  </React.StrictMode>
);
