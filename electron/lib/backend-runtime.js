'use strict';

const fs = require('fs');
const path = require('path');

function packagedAgentExe(resourcesPath) {
  return path.join(resourcesPath, 'backend', 'agent', 'eco_capture_agent', 'eco_capture_agent.exe');
}

function agentAvailable({
  isPackaged,
  resourcesPath,
  srcDir,
  fsImpl = fs,
  env = process.env
} = {}) {
  if (String(env.ECO_SPLIT_BACKENDS || '') === '1') return false;
  if (!isPackaged) {
    return Boolean(srcDir && fsImpl.existsSync(path.join(srcDir, 'eco_capture_agent.py')));
  }
  return Boolean(resourcesPath && fsImpl.existsSync(packagedAgentExe(resourcesPath)));
}

/**
 * Resolve spawn command/args for damage bridge, NPC translator, or unified agent.
 */
function resolveBackendRuntime({
  name,
  selectedGamePid,
  isPackaged,
  resourcesPath,
  srcDir,
  backendDir,
  pythonCommand,
  extraArgs = []
}) {
  const processArgs = [
    ...(selectedGamePid ? ['--pid', String(selectedGamePid)] : []),
    ...extraArgs
  ];
  if (!isPackaged) {
    const scriptName = name === 'agent'
      ? 'eco_capture_agent.py'
      : name === 'damage' ? 'eco_damage_bridge.py' : 'eco_npc_mitm.py';
    const scriptPath = path.join(srcDir, scriptName);
    return {
      command: pythonCommand || process.env.ECO_PYTHON || 'python',
      args: ['-u', scriptPath, ...processArgs],
      cwd: srcDir
    };
  }
  if (name === 'agent') {
    return {
      command: packagedAgentExe(resourcesPath),
      args: processArgs,
      cwd: path.join(resourcesPath, 'backend', 'agent')
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
  launchLabel,
  agentAvailable,
  packagedAgentExe
};
