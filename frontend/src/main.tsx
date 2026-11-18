import { QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'

import App from './App'
import { ToastProvider } from './components/Toaster'
import { AuthProvider } from './hooks/useAuth'
import './index.css'
import { createQueryClient } from './queryClient'
import { installSmoothWheel } from './utils/smoothScroll'

const queryClient = createQueryClient()

// Mouse-wheel scrolling glides instead of jumping (see utils/smoothScroll).
installSmoothWheel()

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <ToastProvider>
            <App />
          </ToastProvider>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
)
