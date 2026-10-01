import React from 'react'
import { createRoot } from 'react-dom/client'
import '@navin/design-system/tokens.css'
import './styles.css'
import { MailApp } from './MailApp.js'
import { createMailClient } from './create-client.js'

/**
 * Browser entry point.
 *
 * The API base URL is not hard-coded: set `VITE_NAVIND_BASE_URL` at build time
 * (for example when Mail is served from a different origin than navind), or
 * default to the same origin serving this bundle.
 */
const baseUrl =
  (import.meta.env.VITE_NAVIND_BASE_URL as string | undefined) ?? window.location.origin

const container = document.getElementById('root')
if (!container) {
  throw new Error('Navin Mail Web requires a #root element')
}

createRoot(container).render(
  <React.StrictMode>
    <MailApp clientFactory={(getToken) => createMailClient({ baseUrl, getToken })} />
  </React.StrictMode>,
)
