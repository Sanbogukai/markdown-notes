// Settings for Vite, the tool that runs the dev server (npm run dev) and builds client/dist.

// Lets Vite understand JSX and refresh components in place while editing.
import react from '@vitejs/plugin-react'
// A helper that types the settings object; it changes nothing else.
import { defineConfig } from 'vite'

// The Express server's address during development (server/src/index.ts listens on 3000).
const API_SERVER = 'http://localhost:3000'

// https://vite.dev/config/
export default defineConfig({
  // Turns the React support on.
  plugins: [react()],
  // Settings for the development server only; the production build ignores them.
  server: {
    // Send /api calls to the Express server, so the browser sees one origin and no CORS setup is needed.
    proxy: {
      // Any request starting with /api goes to the API server.
      '/api': API_SERVER,
    },
  },
})
