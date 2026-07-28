# Technical debt & maintenance

Living notes for ECO Toolbox. Prefer small, test-backed cleanups over rewrites.

## Done (recent)

- Settings cache + state bus throttle + light `app:state`
- Modular `electron/lib/*` (wallpaper, capture env, diagnostics, presets, …)
- Stable error codes `ECO_E01`–`ECO_E09` (`electron/lib/error-codes.js`)
- Local crash logs under `%APPDATA%/eco-toolbox/logs/crash/`
- `npm run smoke` module + unit smoke without full UI

## Shipped / local (post-0.2.9)

- Window-title memory for main + Xiaoya PIDs
- Session battle report (export / copy)
- Help page with ECO_Exx table, hotkeys, version
- **v0.2.12**: sticky ride channels, grind readiness notices
- Diagnostic pack export (UI logs + snapshot + capture jsonl tail)
- Grind observability (exp/level packet counts, status/hint)
- Ride/possession badges on overview + damage pages
- Multi-client process switch auto stop→attach→start + title labels
- ActionBanner next-step guidance; channel bars + DPS sparkline
- Damage page hide-empty-channels; diag pack zip; preset↔windowTitle
- Settings: restore recommended defaults + help link
- Meter modularization: `eco_damage_ride` / `eco_damage_identity` mixins
- Diagnostic pack: `SUMMARY.txt` + `eco_damage_meter.log` tails for remote support
- `diagnostics.js`: zip + named log tails + remote summary helpers
- **v0.2.15**: translation quality — default `deepseek-chat`, ECO glossary prompts, shared-dict upload gate (trusted models + dirty filter), default public sync
- **v0.2.16**: ride vs walk-partner classification (wiki-aligned), safer NPC mitm (no game-thread wait), delayed graceful quit before app exit

## Still optional

| Item | Why | Effort |
|------|-----|--------|
| Further split remaining IPC out of `main.js` | Readability | Medium |
| Gradual TypeScript for preload/IPC contracts | Fewer wrong payloads | Medium |
| Delete `electron/renderer-legacy` after confirmation | Repo noise | Small |
| E2E with Playwright against demo | Regression | Medium |
| Move `archive/` / research trees out of product clone | Clone size | Process |
| Dual simultaneous damage capture | Product complexity | Large |

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
