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
  logs,
  identity = null,
  connectionHealth = null,
  snapshotSummary = null
}) {
  let elevated = null;
  try {
    // Best-effort; may be null outside Windows admin checks.
    elevated = Boolean(process.platform === 'win32' && require('child_process'));
  } catch {
    elevated = null;
  }

  const id = identity && typeof identity === 'object' ? identity : {};
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
      release: os.release(),
      elevated
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
    // Character identity — critical when debugging account-switch rebind.
    identity: {
      self_id: id.self_id ?? null,
      candidates: id.candidates ?? '',
      captureRunning: Boolean(id.captureRunning),
      attached_pid: id.attached_pid ?? null,
      selected_pid: id.selected_pid ?? null,
      pid_mismatch: Boolean(id.pid_mismatch),
      total_dealt: id.total_dealt ?? null,
      total_taken: id.total_taken ?? null,
      skill_cast_total: id.skill_cast_total ?? null,
      packet_count: id.packet_count ?? null,
      last_packet_age: id.last_packet_age ?? null,
      ride_mode: id.ride_mode ?? null,
      ride_mount_id: id.ride_mount_id ?? null,
      possession_host_id: id.possession_host_id ?? null
    },
    snapshotSummary: snapshotSummary || null,
    connectionHealth: connectionHealth || null,
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
  lines.push('', '## identity', JSON.stringify(diag.identity || {}, null, 2));
  if (diag.snapshotSummary) {
    lines.push('', '## snapshot summary', JSON.stringify(diag.snapshotSummary, null, 2));
  }
  if (diag.connectionHealth) {
    lines.push('', '## connection health', JSON.stringify(diag.connectionHealth, null, 2));
  }
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

/**
 * Read the tail of the newest matching jsonl under logDirs.
 * @param {string[]} logDirs
 * @param {{ prefix?: string, maxBytes?: number, maxFiles?: number }} options
 */
function collectCaptureLogTails(logDirs, options = {}) {
  const prefix = options.prefix || 'damage_electron_';
  const maxBytes = Math.max(4_000, Number(options.maxBytes) || 120_000);
  const maxFiles = Math.max(1, Number(options.maxFiles) || 2);
  const found = [];

  for (const dir of logDirs || []) {
    if (!dir || !fs.existsSync(dir)) continue;
    let names = [];
    try {
      names = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (!name.startsWith(prefix) || !name.endsWith('.jsonl')) continue;
      const full = path.join(dir, name);
      try {
        const st = fs.statSync(full);
        if (!st.isFile()) continue;
        found.push({ path: full, name, size: st.size, mtimeMs: st.mtimeMs });
      } catch {
        /* skip */
      }
    }
  }

  found.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const selected = found.slice(0, maxFiles);
  const tails = [];

  for (const file of selected) {
    try {
      if (file.size <= 0) {
        tails.push({
          name: file.name,
          path: file.path,
          size: 0,
          empty: true,
          text: ''
        });
        continue;
      }
      const fd = fs.openSync(file.path, 'r');
      try {
        const start = Math.max(0, file.size - maxBytes);
        const len = file.size - start;
        const buf = Buffer.alloc(len);
        fs.readSync(fd, buf, 0, len, start);
        let text = buf.toString('utf8');
        // Drop partial first line when we mid-sliced the file.
        if (start > 0) {
          const nl = text.indexOf('\n');
          if (nl >= 0) text = text.slice(nl + 1);
        }
        tails.push({
          name: file.name,
          path: file.path,
          size: file.size,
          empty: false,
          truncated: start > 0,
          text
        });
      } finally {
        fs.closeSync(fd);
      }
    } catch (error) {
      tails.push({
        name: file.name,
        path: file.path,
        size: file.size,
        error: error.message || String(error),
        text: ''
      });
    }
  }

  return { files: found.slice(0, 8), tails };
}

/**
 * Write a multi-file diagnostic pack into outDir.
 * @returns {{ outDir: string, files: string[] }}
 */
function writeDiagnosticPack(outDir, {
  diag,
  text,
  snapshot = null,
  captureTails = null
} = {}) {
  fs.mkdirSync(outDir, { recursive: true });
  const written = [];

  const write = (name, body) => {
    const full = path.join(outDir, name);
    fs.writeFileSync(full, body, 'utf8');
    written.push(full);
  };

  write('diagnostic.txt', text || formatDiagnosticsText(diag || {}));
  write('diagnostic.json', `${JSON.stringify(diag || {}, null, 2)}\n`);

  if (snapshot != null) {
    write('snapshot.json', `${JSON.stringify(snapshot, null, 2)}\n`);
  }

  const uiLogs = (diag && diag.recentLogs) || [];
  const uiBody = uiLogs
    .map((e) => `[${e.time || ''}] [${e.service || ''}] [${e.level || ''}] ${e.message || ''}`)
    .join('\n');
  write('ui-logs.txt', `${uiBody}\n`);

  if (captureTails && Array.isArray(captureTails.tails)) {
    if (!captureTails.tails.length) {
      write(
        'capture-tail-README.txt',
        '未找到 damage_electron_*.jsonl 采集日志。\n可能原因：采集未启动、日志目录为空、或以管理员运行后数据目录不同。\n'
      );
    }
    for (const tail of captureTails.tails) {
      const safe = String(tail.name || 'capture').replace(/[^\w.\-]+/g, '_');
      if (tail.empty) {
        write(`${safe}.EMPTY.txt`, `文件存在但为 0 字节：${tail.path || ''}\n采集可能未写入任何封包。\n`);
      } else if (tail.error) {
        write(`${safe}.ERROR.txt`, `读取失败：${tail.error}\npath=${tail.path || ''}\n`);
      } else {
        const header = [
          `# source: ${tail.path || tail.name}`,
          `# size: ${tail.size}`,
          `# truncated: ${Boolean(tail.truncated)}`,
          ''
        ].join('\n');
        write(safe, header + (tail.text || ''));
      }
    }
    write(
      'capture-index.json',
      `${JSON.stringify({ files: captureTails.files || [], tails: (captureTails.tails || []).map((t) => ({
        name: t.name,
        path: t.path,
        size: t.size,
        empty: t.empty,
        truncated: t.truncated,
        error: t.error || null
      })) }, null, 2)}\n`
    );
  }

  write(
    'README.txt',
    [
      'ECO 工具箱诊断包',
      '',
      '包含：',
      '  diagnostic.txt / .json  — 版本、进程、服务、身份、UI 日志',
      '  snapshot.json           — 导出时的战斗/肝度快照（若有）',
      '  ui-logs.txt             — 界面环形日志',
      '  damage_electron_*.jsonl — 底层采集日志尾部（若有）',
      '',
      '请整包压缩后发给协助者。',
      ''
    ].join('\n')
  );

  return { outDir, files: written };
}

function buildSnapshotSummary(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const grind = snapshot.grind || {};
  return {
    self_id: snapshot.self_id ?? null,
    rebind_pending: Boolean(snapshot.rebind_pending),
    ride_mode: Boolean(snapshot.ride_mode),
    ride_mount_id: snapshot.ride_mount_id ?? null,
    ride_mode_remaining: snapshot.ride_mode_remaining ?? null,
    possession_host_id: snapshot.possession_host_id ?? null,
    dealt: snapshot.dealt ?? 0,
    self_skill_dealt: snapshot.self_skill_dealt ?? 0,
    self_normal_dealt: snapshot.self_normal_dealt ?? 0,
    ride_skill_dealt: snapshot.ride_skill_dealt ?? 0,
    ride_normal_dealt: snapshot.ride_normal_dealt ?? 0,
    pet_dealt: snapshot.pet_dealt ?? 0,
    packet_count: snapshot.packet_count ?? 0,
    last_packet_age: snapshot.last_packet_age ?? null,
    grind: {
      ready: Boolean(grind.ready),
      status: grind.status || null,
      level: grind.level ?? null,
      exp_packets: grind.exp_packets ?? grind.exp_update_count ?? null,
      level_packets: grind.level_packets ?? null,
      last_exp_packet_age: grind.last_exp_packet_age ?? null,
      session_cexp_pct: grind.session_cexp_pct ?? 0,
      hint: grind.hint || null
    },
    events: Array.isArray(snapshot.events) ? snapshot.events.slice(0, 16) : []
  };
}

module.exports = {
  collectDiagnostics,
  formatDiagnosticsText,
  writeDiagnosticBundle,
  collectCaptureLogTails,
  writeDiagnosticPack,
  buildSnapshotSummary
};
