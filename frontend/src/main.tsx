import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AuthLandingPage } from './pages/AuthLandingPage'
import { DashboardPage } from './pages/DashboardPage'
import '@fontsource/dm-sans/latin-400.css'
import '@fontsource/dm-sans/latin-500.css'
import '@fontsource/dm-sans/latin-600.css'
import '@fontsource/manrope/latin-400.css'
import '@fontsource/manrope/latin-500.css'
import '@fontsource/manrope/latin-600.css'
import '@fontsource/manrope/latin-700.css'
import '@fontsource/cormorant-garamond/latin-500.css'
import '@fontsource/cormorant-garamond/latin-600.css'
import './styles.css'

const Page = window.location.pathname === '/dashboard' ? DashboardPage : AuthLandingPage

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Page />
  </StrictMode>,
)
