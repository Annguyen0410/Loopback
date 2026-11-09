import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App'
import ErrorBoundary from './components/ErrorBoundary'
import './i18n'
import './styles/global.css'
import { initAppearance } from './lib/theme'

// Paint the saved theme before the first render so there is no colour flash.
initAppearance()

const root = document.getElementById('root') as HTMLElement

// Without the preload bridge every page would throw inside its effects and the
// window would stay blank. Show a real explanation instead.
if (!window.api) {
  root.innerHTML = `
    <div style="font-family:'Segoe UI',system-ui,sans-serif;color:#e2e6ee;background:#0f1117;height:100%;display:flex;align-items:center;justify-content:center">
      <div style="max-width:420px">
        <h1 style="font-size:20px;margin:0 0 8px">TaskOrbit could not start its bridge</h1>
        <p style="color:#8b93a7;line-height:1.6">
          The preload script did not load, so the interface cannot talk to the app.
          Restart TaskOrbit, and if it keeps happening run <code>npm run build</code> again
          before starting the app.
        </p>
      </div>
    </div>`
} else {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <ErrorBoundary>
        <HashRouter>
          <App />
        </HashRouter>
      </ErrorBoundary>
    </React.StrictMode>
  )
}
