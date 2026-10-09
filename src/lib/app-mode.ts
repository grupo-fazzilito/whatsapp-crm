// Deployment mode, set with the MODE env var (server side):
//   DEV  (default) — testing: auth codes are returned to the browser and
//        filled in automatically, logged on the server, and a failing or
//        missing SMTP does not block sign-up.
//   PROD — production: codes only travel by email and are never logged.

export type AppMode = 'DEV' | 'PROD'

export function appMode(): AppMode {
  return (process.env.MODE ?? '').trim().toUpperCase() === 'PROD' ? 'PROD' : 'DEV'
}

export const isDevMode = () => appMode() === 'DEV'
