import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { LumaApp } from './luma/App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LumaApp />
  </StrictMode>,
)
