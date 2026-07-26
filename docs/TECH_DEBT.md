# Technical debt & maintenance

Living notes for ECO Toolbox. Prefer small, test-backed cleanups over rewrites.

## Done (recent)

- Settings cache + state bus throttle + light `app:state`
- Modular `electron/lib/*` (wallpaper, capture env, diagnostics, presets, …)
- Stable error codes `ECO_E01`–`ECO_E09` (`electron/lib/error-codes.js`)
- Local crash logs under `%APPDATA%/eco-toolbox/logs/crash/`
- `npm run smoke` module + unit smoke without full UI

## Still optional

| Item | Why | Effort |
|------|-----|--------|
| Split remaining IPC out of `main.js` | Readability | Medium |
| Gradual TypeScript for preload/IPC contracts | Fewer wrong payloads | Medium |
| Delete `electron/renderer-legacy` after confirmation | Repo noise | Small |
| E2E with Spectron/Playwright against demo | Regression | Medium |
| Chart/report features | Product, not debt | Large |
| Move `archive/` / research trees out of product clone | Clone size | Process |

## Commands

```powershell
cd electron
npm test
npm run smoke
npm run build:ui
```

Release: tag must match `electron/package.json` version (`vX.Y.Z`).

## Error codes (user-visible)

| Code | Meaning |
|------|---------|
| ECO_E01 | No game process |
| ECO_E02 | Process gone |
| ECO_E03 | Access denied / need admin |
| ECO_E04 | Frida attach failed |
| ECO_E05 | Backend script missing |
| ECO_E06 | Translator not configured |
| ECO_E07 | Backend spawn failed |
| ECO_E08 | Process list failed |
| ECO_E09 | Unknown |

Remote support: ask for **复制诊断** output; codes appear in service messages and diagnostics.
