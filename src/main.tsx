import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { applyTheme } from './lib/settings'
import './style.css'

let saved = 'midnight'
try { saved = localStorage.getItem('nova-theme') || 'midnight' } catch { /* storage blocked */ }
applyTheme(saved)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
