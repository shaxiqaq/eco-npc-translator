# Offline / import tools

Scripts under `src/` that are **not** part of the packaged runtime bridge:

| Script | Purpose |
|--------|---------|
| `import_client_names.py` / `导入客户端名称表.py` | Import skill/buff name tables from client dumps |
| `import_sagaeco_buffs.py` / `import_sagaeco_skills.py` | SagaECO reference imports |
| `pretranslate.py` / `translate_mob_names_local.py` | Dictionary helpers |
| `align_repo.py` | Repo maintenance |

Runtime processes used by the Electron app:

- `eco_damage_bridge.py` + `eco_damage_meter.py` + capture scripts
- `eco_npc_mitm.py`
- `eco_process.py` (shared PID resolve)

Keep import tools out of PyInstaller entrypoints unless a feature explicitly needs them.
