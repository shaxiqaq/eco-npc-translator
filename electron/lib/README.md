# Main-process modules

**Entry is `main.js` only.** There is no parallel TypeScript main/services tree.

`main.js` is the composition root (windows, lifecycle, wiring). Domain logic lives here:

| Module | Role |
|--------|------|
| `settings-cache.js` | In-memory app settings + debounced persist |
| `state-bus.js` | Throttled `app:state` + dedicated snapshot/log channels |
| `overlay-snapshot.js` | Slim combat payload for the status overlay |
| `wallpaper.js` | Background import, eco-bg paths, appearance helpers |
| `custom-buffs-store.js` | Custom buff/CD JSON store |
| `skill-library-store.js` | Recent skill chips + client name preference |
| `backend-env.js` / `backend-runtime.js` | Spawn env + command paths for Frida hosts |
| `child-lifecycle.js` | Graceful Frida teardown (Windows-safe) |
| `process-selection.js` | Main / Xiaoya PID resolution |
| `logs-service.js` | Log filter + export formatting |
| `diagnostics.js` | Support diagnostic bundle |
| `overlay-geometry.js` | Overlay bounds/opacity |
| `demo-snapshot.js` | `ECO_UI_DEMO` fake meter data |
| `error-codes.js` | Stable `ECO_Exx` codes for support |
| `crash-log.js` | uncaughtException / rejection dumps |
| `system-health.js` | Elevated + connection health summary |
| `character-presets.js` | Multi-character preset store |
| `config-bundle.js` | Portable settings import/export |
| `game-processes.js` | PowerShell eco.exe enumeration |
| `skill-icons.js` | Icon helper + cache |
| `update-service.js` | electron-updater façade |
| `xiaoya-core-service.js` | Xiaoya native core host |
| `capture-host.js` | Combat capture child + JSON protocol |
| `translator-host.js` | NPC translator child + JSON/legacy logs |
| `backend-protocol.js` | Shared JSON-lines parse/write |
| `ipc/*.js` | Domain IPC handlers (`ctx.*`, no `with`) |

Prefer adding a new `lib/*.js` over growing `main.js` further.

Unified Frida attach is the default when `eco_capture_agent` is present
(`src/eco_capture_agent.py` in dev, `backend/agent/...exe` when packaged).
Set `ECO_SPLIT_BACKENDS=1` to force the two legacy processes.
