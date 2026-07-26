'use strict';

const path = require('path');

/**
 * Resolve spawn command/args for damage bridge or NPC translator.
 */
function resolveBackendRuntime({
  name,
  selectedGamePid,
  isPackaged,
  resourcesPath,
  srcDir,
  backendDir,
  pythonCommand
}) {
  const processArgs = selectedGamePid ? ['--pid', String(selectedGamePid)] : [];
  if (!isPackaged) {
    const scriptName = name === 'damage' ? 'eco_damage_bridge.py' : 'eco_npc_mitm.py';
    const scriptPath = path.join(srcDir, scriptName);
    return {
      command: pythonCommand || process.env.ECO_PYTHON || 'python',
      args: ['-u', scriptPath, ...processArgs],
      cwd: srcDir
    };
  }
  if (name === 'damage') {
    return {
      command: path.join(resourcesPath, 'backend', 'damage', 'eco_damage_bridge', 'eco_damage_bridge.exe'),
      args: processArgs,
      cwd: backendDir
    };
  }
  return {
    command: path.join(resourcesPath, 'backend', 'translator', 'eco_npc_mitm', 'eco_npc_mitm.exe'),
    args: processArgs,
    cwd: backendDir
  };
}

function launchLabel(runtime, isPackaged) {
  if (!runtime) return 'backend';
  return isPackaged
    ? path.basename(runtime.command)
    : path.basename(runtime.args?.[1] || runtime.command);
}

module.exports = {
  resolveBackendRuntime,
  launchLabel
};
