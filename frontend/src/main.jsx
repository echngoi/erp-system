import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import './index.css'
import App from './App.jsx'

// Polyfill for antd v6 / @ant-design/cssinjs performance.clearMarks bug (React 19 + StrictMode)
if (typeof performance !== 'undefined') {
  if (!performance.clearMarks) performance.clearMarks = () => {}
  if (!performance.mark) performance.mark = () => {}
  if (!performance.measure) performance.measure = () => {}
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AuthProvider>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </AuthProvider>
  </StrictMode>,
)
