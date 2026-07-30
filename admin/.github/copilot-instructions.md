Build, test, and lint

- Install deps: npm install
- Start (dev): npm start  # launches Expo (expo start)
- Run on Android emulator/device: npm run android  # expo run:android
- Run on iOS simulator/device: npm run ios  # expo run:ios
- Run web: npm run web  # expo start --web
- Lint: npm run lint  # runs `expo lint` (uses eslint)
  - Lint a single file: npx eslint path/to/file.tsx
- Tests: jest preset (jest-expo)
  - Run full suite: npx jest
  - Run a single test file: npx jest path/to/file.test.ts
  - Run a single test name: npx jest -t "test name"

High-level architecture

- Expo (managed) React Native app using Expo Router (file-based routing). Root UI lives in the app/ directory. Entry: expo-router/entry (see package.json).
- Routing: app/ uses file-based routes. Route groups use parentheses (e.g. (tabs)) to group/hide paths.
- Providers (global state): AuthProvider -> controls authentication (expo-secure-store). After AuthProvider: OrderProvider, SocketProvider, ThemeProvider. The app relies on this provider nesting (see app/_layout.tsx).
- Core domains:
  - services/: API calls, auth token helpers, printer management (BLE thermal printers), new-order queueing, permissions helpers.
  - providers/: React context providers (auth, order, socket, theme).
  - components/: UI primitives (headers, lists, indicators, charts).
  - app/: route screens and UI (tabs, dashboard, order details, sign-in, printer setup).
- Printing & devices: BLE thermal-printer implementation (services/thermal-printer.ts) + persistent print queue (AsyncStorage). Printer jobs are retried on reconnect.
- Realtime: Socket.IO client connects to EXPO_PUBLIC_SERVER_URL and emits/receives new-order events. newOrders-service enqueues and shows alerts.

Key conventions and repo-specific rules

- File-based routing: use the app/ folder and follow Expo Router naming; put tab groups in parentheses (e.g., (tabs)).
- Provider ordering: AuthProvider must wrap the rest. Do NOT mount OrderProvider inside the unauthenticated branch — the code relies on auth state before initialising order/socket providers (see comment in app/_layout.tsx).
- State persistence keys (AsyncStorage):
  - Print queue saved under key: "print_queue"
  - Saved printers: "thermal_printers"
  - Default printer id: "default_thermal_printer"
  - Auto-print preference: "auto_print_enabled"
- Environment variables the app expects at runtime (Expo public env vars):
  - EXPO_PUBLIC_SERVER_URL (required) — base URL for API + sockets
  - EXPO_PUBLIC_LOGO_URL (optional) — logo used by PageHeader
- Auth & roles: tokens are stored in SecureStore under "token". The app checks decoded JWT role === "ADMIN" for access. Use SecureStore utilities in services/auth.ts.
- Printers: Thermal printer uses ESC/POS bytes and BLE characteristics. Tests/dev: scanning and connect flows require platform permissions (see services/thermal-printer.ts). When adding new printer models, update PRINTER_SERVICE_UUIDS and PRINTER_CHARACTERISTIC_UUIDS if needed.
- New-order flow: newOrders-service uses an internal queue + EventEmitter. Use resolveCurrentAlert() to dismiss the modal and allow the next queued alert to show.
- TypeScript path alias: "@/*" is mapped to project root in tsconfig.json — import using @/lib, @/services, etc.
- Styling: nativewind (Tailwind) classes are used with global.css; prefer utility classes for screen layout.

Notes from README

- The README documents that expo-av is used only for playback and the RECORD_AUDIO permission is included but not used for recording. Keep that in mind when reviewing permissions.
- The README mentions npm run reset-project (moves starter code to app-example). If you rely on that, verify the referenced script exists in scripts/ (some projects include a helper script).

Helpful pointers for future Copilot sessions

- Root: work from the app/ and providers/ and services/ folders first to understand UI flows and side effects (printing, sockets, persistence).
- When changing auth or socket code, check services/auth.ts and providers/socket-provider.ts together — token handling affects socket connections.
- Printer changes often require physical device testing; keep AsyncStorage keys and retry logic in mind to avoid losing pending jobs.

Files consulted while authoring: package.json, README.md, tsconfig.json, app/_layout.tsx, providers/*, services/*

If you'd like this tailored further (add common quick-fix snippets, common env values, or CI/test setup), say which area to expand.