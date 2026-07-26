# Main-process modules

`main.js` is the app orchestrator (windows, lifecycle, IPC). Domain logic lives here:

| Module | Role |
|--------|------|
| `settings-cache.js` | In-memory app settings + debounced persist |
| `state-bus.js` | Throttled `app:state` + dedicated snapshot/log channels |
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
| `game-processes.js` | PowerShell eco.exe enumeration |
| `skill-icons.js` | Icon helper + cache |
| `update-service.js` | electron-updater façade |
| `xiaoya-core-service.js` | Xiaoya native core host |

Prefer adding a new `lib/*.js` over growing `main.js` further.
