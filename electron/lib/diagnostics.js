'use strict';

const os = require('os');
const fs = require('fs');
const path = require('path');

function collectDiagnostics({
  appVersion,
  isPackaged,
  selectedGamePid,
  selectedXiaoyaPid,
  gameProcesses,
  captureIntents,
  services,
  logs
}) {
  let elevated = null;
  try {
    // Best-effort; may be null outside Windows admin checks.
    elevated = Boolean(process.platform === 'win32' && require('child_process'));
  } catch {
    elevated = null;
  }

  return {
    exportedAt: new Date().toISOString(),
    app: {
      version: appVersion,
      packaged: Boolean(isPackaged),
      platform: process.platform,
      arch: process.arch,
      electron: process.versions?.electron,
      node: process.versions?.node,
      hostname: os.hostname(),
      release: os.release()
    },
    selection: {
      selectedGamePid: selectedGamePid || null,
      selectedXiaoyaPid: selectedXiaoyaPid || null,
      gameProcesses: (gameProcesses || []).map((p) => ({
        pid: p.pid,
        title: p.title || '',
        started: p.started || '',
        path: p.path || ''
      }))
    },
    captureIntents: captureIntents || {},
    services: services || {},
    // Surface ECO_Exx codes when present on service state.
    errorCodes: Object.fromEntries(
      Object.entries(services || {})
        .filter(([, value]) => value && value.errorCode)
        .map(([key, value]) => [key, { code: value.errorCode, message: value.message || '' }])
    ),
    recentLogs: (logs || []).slice(-80)
  };
}

function formatDiagnosticsText(diag) {
  const lines = [
    '# ECO Toolbox diagnostic bundle',
    `# time: ${diag.exportedAt}`,
    `# version: ${diag.app?.version}`,
    `# packaged: ${diag.app?.packaged}`,
    `# platform: ${diag.app?.platform} ${diag.app?.arch} (${diag.app?.release})`,
    `# selectedGamePid: ${diag.selection?.selectedGamePid}`,
    `# selectedXiaoyaPid: ${diag.selection?.selectedXiaoyaPid}`,
    '',
    '## processes'
  ];
  for (const p of diag.selection?.gameProcesses || []) {
    lines.push(`- pid=${p.pid} title=${JSON.stringify(p.title)} path=${JSON.stringify(p.path)}`);
  }
  lines.push('', '## capture intents', JSON.stringify(diag.captureIntents || {}, null, 2));
  lines.push('', '## services', JSON.stringify(diag.services || {}, null, 2));
  lines.push('', '## recent logs');
  for (const entry of diag.recentLogs || []) {
    lines.push(
      `[${entry.time || ''}] [${entry.service || ''}] [${entry.level || ''}] ${entry.message || ''}`
    );
  }
  lines.push('');
  return lines.join('\n');
}

function writeDiagnosticBundle(dir, diag) {
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const base = path.join(dir, `eco-toolbox-diag-${stamp}`);
  const jsonPath = `${base}.json`;
  const textPath = `${base}.txt`;
  fs.writeFileSync(jsonPath, `${JSON.stringify(diag, null, 2)}\n`, 'utf8');
  fs.writeFileSync(textPath, formatDiagnosticsText(diag), 'utf8');
  return { jsonPath, textPath };
}

module.exports = {
  collectDiagnostics,
  formatDiagnosticsText,
  writeDiagnosticBundle
};
