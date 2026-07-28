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
 * Collect tails of exact log filenames (e.g. eco_damage_meter.log).
 * Picks the newest match across logDirs for each basename.
 */
function collectNamedLogTails(logDirs, basenames, options = {}) {
  const maxBytes = Math.max(2_000, Number(options.maxBytes) || 80_000);
  const names = Array.isArray(basenames) ? basenames : [basenames];
  const tails = [];

  for (const base of names) {
    const baseName = String(base || '').trim();
    if (!baseName) continue;
    let best = null;
    for (const dir of logDirs || []) {
      if (!dir) continue;
      const full = path.join(dir, baseName);
      try {
        if (!fs.existsSync(full)) continue;
        const st = fs.statSync(full);
        if (!st.isFile()) continue;
        if (!best || st.mtimeMs > best.mtimeMs) {
          best = { path: full, name: baseName, size: st.size, mtimeMs: st.mtimeMs };
        }
      } catch {
        /* skip */
      }
    }
    if (!best) {
      tails.push({ name: baseName, path: null, size: 0, missing: true, text: '' });
      continue;
    }
    try {
      if (best.size <= 0) {
        tails.push({ ...best, empty: true, text: '' });
        continue;
      }
      const fd = fs.openSync(best.path, 'r');
      try {
        const start = Math.max(0, best.size - maxBytes);
        const len = best.size - start;
        const buf = Buffer.alloc(len);
        fs.readSync(fd, buf, 0, len, start);
        let text = buf.toString('utf8');
        if (start > 0) {
          const nl = text.indexOf('\n');
          if (nl >= 0) text = text.slice(nl + 1);
        }
        tails.push({
          ...best,
          empty: false,
          truncated: start > 0,
          text
        });
      } finally {
        fs.closeSync(fd);
      }
    } catch (error) {
      tails.push({
        ...best,
        error: error.message || String(error),
        text: ''
      });
    }
  }
  return { tails };
}

/**
 * One-page Chinese summary for remote helpers — read this first.
 */
function buildRemoteSupportSummary({
  diag = null,
  snapshot = null,
  captureTails = null,
  meterLogs = null,
  hints = null
} = {}) {
  const d = diag || {};
  const id = d.identity || {};
  const snap = snapshot || {};
  const grind = snap.grind || d.snapshotSummary?.grind || {};
  const services = d.services || {};
  const health = d.connectionHealth || {};
  const lines = [];

  const yn = (v) => (v ? '是' : '否');
  const age = (s) => {
    if (s == null || !Number.isFinite(Number(s))) return '—';
    const n = Number(s);
    if (n < 5) return '刚刚';
    if (n < 60) return `${Math.round(n)}秒前`;
    if (n < 3600) return `${Math.round(n / 60)}分钟前`;
    return `${(n / 3600).toFixed(1)}小时前`;
  };

  lines.push('# ECO 远程排障一键摘要');
  lines.push(`# 导出时间: ${d.exportedAt || new Date().toISOString()}`);
  lines.push(`# 版本: ${d.app?.version || '—'} · 安装包: ${yn(d.app?.packaged)} · 系统: ${d.app?.platform || ''} ${d.app?.arch || ''}`);
  lines.push('');
  lines.push('## 结论速览（协助者先看这里）');

  const findings = [];
  if (!id.captureRunning) findings.push('采集未在运行');
  if (id.pid_mismatch) {
    findings.push(`PID 不一致：挂接 ${id.attached_pid} ≠ 选中 ${id.selected_pid}`);
  }
  if (id.captureRunning && id.self_id == null) findings.push('已采集但未识别角色 self_id');
  if (id.captureRunning && (id.packet_count === 0 || id.packet_count == null)) {
    findings.push('packet_count=0：可能未进图或未管理员运行');
  }
  const captureEmpty = (captureTails?.tails || []).some((t) => t.empty || t.missing);
  if (captureEmpty) findings.push('damage_electron jsonl 为空或缺失');
  const meterMissing = (meterLogs?.tails || []).filter((t) => t.name && t.name.includes('meter'));
  if (meterMissing.some((t) => t.missing)) findings.push('缺少 eco_damage_meter.log');
  if (id.captureRunning && !grind.ready && (Number(snap.dealt) || Number(id.total_dealt) || 0) > 0) {
    findings.push('有伤害但经验未就绪（可能未收到 565 经验包）');
  }
  if (health.status && health.status !== 'ok' && health.status !== 'ready') {
    findings.push(`连接健康: ${health.status}`);
  }
  if (d.app?.elevated === false) findings.push('未以管理员运行（elevated=false）');
  if (!findings.length) findings.push('未自动发现硬故障；请结合 SUMMARY 下方细节与 meter 日志');

  for (const f of findings) lines.push(`- ${f}`);
  lines.push('');

  lines.push('## 进程与采集');
  lines.push(`- 选中主 PID: ${d.selection?.selectedGamePid ?? '—'}`);
  lines.push(`- 挂接 PID: ${id.attached_pid ?? '—'}`);
  lines.push(`- 采集运行中: ${yn(id.captureRunning)}`);
  lines.push(`- 伤害 intent: ${yn(d.captureIntents?.damage)} · 监控 intent: ${yn(d.captureIntents?.monitoring)}`);
  lines.push(`- packet_count: ${id.packet_count ?? '—'} · 上次封包: ${age(id.last_packet_age)}`);
  lines.push(`- 窗口记忆: ${d.selection?.gameProcesses?.find((p) => p.pid === d.selection?.selectedGamePid)?.title || '—'}`);
  for (const p of d.selection?.gameProcesses || []) {
    lines.push(`  · pid=${p.pid} title=${JSON.stringify(p.title || '')} started=${p.started || ''}`);
  }
  lines.push('');

  lines.push('## 角色 / 代理状态');
  lines.push(`- self_id: ${id.self_id ?? snap.self_id ?? '—'}${snap.rebind_pending || id.rebind_pending ? '（待确认 rebind）' : ''}`);
  lines.push(`- 骑宠: ${yn(snap.ride_mode || id.ride_mode)} mount=${snap.ride_mount_id ?? id.ride_mount_id ?? '—'}`);
  lines.push(`- 依凭 host: ${snap.possession_host_id ?? id.possession_host_id ?? '—'}`);
  lines.push('');

  lines.push('## 伤害摘要');
  lines.push(`- 总伤 dealt: ${snap.dealt ?? id.total_dealt ?? 0}`);
  lines.push(`- 自身技能/普攻: ${snap.self_skill_dealt ?? 0} / ${snap.self_normal_dealt ?? 0}`);
  lines.push(`- 骑宠技能/普攻: ${snap.ride_skill_dealt ?? 0} / ${snap.ride_normal_dealt ?? 0}`);
  lines.push(`- 宠物: ${snap.pet_dealt ?? 0} · 受到: ${snap.taken ?? id.total_taken ?? 0}`);
  lines.push(`- 技能释放次数: ${snap.skill_cast_total ?? id.skill_cast_total ?? 0}`);
  lines.push('');

  lines.push('## 肝度 / 经验');
  lines.push(`- ready: ${yn(grind.ready)} · status: ${grind.status || '—'}`);
  lines.push(`- 经验包/等级包: ${grind.exp_packets ?? '—'} / ${grind.level_packets ?? '—'}`);
  lines.push(`- 上次经验包: ${age(grind.last_exp_packet_age)} · 会话基础%: ${grind.session_cexp_pct ?? 0}`);
  lines.push(`- hint: ${grind.hint || '—'}`);
  lines.push('');

  lines.push('## 服务状态');
  for (const [name, svc] of Object.entries(services)) {
    if (!svc || typeof svc !== 'object') continue;
    lines.push(`- ${name}: ${svc.state || '—'} ${svc.message || ''} ${svc.errorCode ? `[${svc.errorCode}]` : ''}`);
  }
  if (d.errorCodes && Object.keys(d.errorCodes).length) {
    lines.push('', '## 错误码');
    for (const [k, v] of Object.entries(d.errorCodes)) {
      lines.push(`- ${k}: ${v.code || ''} ${v.message || ''}`);
    }
  }
  lines.push('');

  lines.push('## 日志文件情况');
  for (const t of meterLogs?.tails || []) {
    if (t.missing) lines.push(`- ${t.name}: 未找到`);
    else if (t.empty) lines.push(`- ${t.name}: 0 字节（${t.path}）`);
    else if (t.error) lines.push(`- ${t.name}: 读取失败 ${t.error}`);
    else lines.push(`- ${t.name}: ${t.size}B truncated=${Boolean(t.truncated)} path=${t.path}`);
  }
  for (const t of captureTails?.tails || []) {
    if (t.empty) lines.push(`- ${t.name}: 空 jsonl`);
    else if (t.error) lines.push(`- ${t.name}: ${t.error}`);
    else lines.push(`- ${t.name}: ${t.size}B truncated=${Boolean(t.truncated)}`);
  }
  if (!(meterLogs?.tails || []).length && !(captureTails?.tails || []).length) {
    lines.push('- （无底层日志附件）');
  }
  lines.push('');

  lines.push('## 建议排查顺序');
  lines.push('1. 看「结论速览」是否指向管理员 / PID / 未识别 / 空日志');
  lines.push('2. 打开 eco_damage_meter.log 搜 error / bind / ride / reidentify');
  lines.push('3. 打开 damage_electron_*.jsonl 是否有 skill_action / damage / player_exp');
  lines.push('4. snapshot.json 核对 self_id、ride_mode、grind.ready');
  lines.push('5. ui-logs.txt 看用户操作时间线（换号识别、清空等）');
  lines.push('');

  if (Array.isArray(hints) && hints.length) {
    lines.push('## 连接健康 hints');
    for (const h of hints) lines.push(`- ${h}`);
    lines.push('');
  }

  const events = snap.events || d.snapshotSummary?.events || [];
  if (events.length) {
    lines.push('## 最近 meter 事件');
    for (const ev of events.slice(0, 12)) {
      if (Array.isArray(ev)) lines.push(`- ${ev[0] || ''} ${ev[1] || ''}`);
      else lines.push(`- ${JSON.stringify(ev)}`);
    }
    lines.push('');
  }

  lines.push('## 发给协助者');
  lines.push('优先发送同目录下的 .zip；若无 zip 则打包整个诊断文件夹。');
  lines.push('协助者请先读本文件 SUMMARY.txt，再按需打开 meter 日志与 jsonl。');
  lines.push('');
  return lines.join('\n');
}

/**
 * Write a multi-file diagnostic pack into outDir.
 * @returns {{ outDir: string, files: string[] }}
 */
function writeDiagnosticPack(outDir, {
  diag,
  text,
  snapshot = null,
  captureTails = null,
  meterLogs = null,
  hints = null
} = {}) {
  fs.mkdirSync(outDir, { recursive: true });
  const written = [];

  const write = (name, body) => {
    const full = path.join(outDir, name);
    fs.writeFileSync(full, body, 'utf8');
    written.push(full);
  };

  // Remote helpers: open this first.
  const summary = buildRemoteSupportSummary({
    diag,
    snapshot,
    captureTails,
    meterLogs,
    hints
  });
  write('SUMMARY.txt', summary);

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

  // Backend Python meter / capture logs (critical for remote support).
  if (meterLogs && Array.isArray(meterLogs.tails)) {
    for (const tail of meterLogs.tails) {
      const safe = String(tail.name || 'meter.log').replace(/[^\w.\-]+/g, '_');
      if (tail.missing) {
        write(`${safe}.MISSING.txt`, `未找到 ${tail.name}\n请确认采集曾启动且 ECO_DATA_DIR/logs 可写。\n`);
      } else if (tail.empty) {
        write(`${safe}.EMPTY.txt`, `文件存在但为 0 字节：${tail.path || ''}\n`);
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
  }

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
      'ECO 工具箱诊断包（远程排障）',
      '',
      '请先阅读：SUMMARY.txt（一键摘要）',
      '',
      '文件说明：',
      '  SUMMARY.txt              — 中文结论速览 + 建议排查顺序（优先）',
      '  diagnostic.txt / .json   — 版本、进程、服务、身份、UI 日志',
      '  snapshot.json            — 导出时的战斗/肝度快照（若有）',
      '  ui-logs.txt              — 界面环形日志',
      '  eco_damage_meter.log     — Python 采集后端运行日志（关键）',
      '  eco_damage_capture.log   — 采集相关日志（若有）',
      '  damage_electron_*.jsonl  — 底层战斗封包日志尾部（若有）',
      '',
      '发送方式：优先发同目录 .zip；否则整夹打包。',
      ''
    ].join('\n')
  );

  return { outDir, files: written };
}

function zipDirectory(dirPath) {
  return new Promise((resolve, reject) => {
    if (process.platform !== 'win32') {
      reject(new Error('zip only implemented on Windows'));
      return;
    }
    const zipPath = `${dirPath}.zip`;
    try {
      if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
    } catch {
      /* ignore */
    }
    const { execFile } = require('child_process');
    const ps = [
      `$ErrorActionPreference='Stop'`,
      `Compress-Archive -Path ${JSON.stringify(dirPath + path.sep + '*')} -DestinationPath ${JSON.stringify(zipPath)} -Force`
    ].join('; ');
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', ps],
      { windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
      (error) => {
        if (error) {
          reject(error);
          return;
        }
        if (!fs.existsSync(zipPath)) {
          reject(new Error('zip file missing after compress'));
          return;
        }
        resolve(zipPath);
      }
    );
  });
}

/** Default log roots for packaged + dev layouts. */
function defaultDiagnosticLogDirs({ localDataDir, backendDir } = {}) {
  const dirs = [];
  if (typeof localDataDir === 'function') {
    try { dirs.push(path.join(localDataDir(), 'logs')); } catch { /* */ }
  } else if (localDataDir) {
    dirs.push(path.join(localDataDir, 'logs'));
  }
  if (typeof backendDir === 'function') {
    try {
      const b = backendDir();
      dirs.push(path.join(b, 'logs'));
      dirs.push(path.join(b, 'data', 'logs'));
      dirs.push(path.join(b, 'src', 'logs'));
    } catch { /* */ }
  } else if (backendDir) {
    dirs.push(path.join(backendDir, 'logs'));
    dirs.push(path.join(backendDir, 'data', 'logs'));
    dirs.push(path.join(backendDir, 'src', 'logs'));
  }
  return [...new Set(dirs.filter(Boolean))];
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
  collectNamedLogTails,
  buildRemoteSupportSummary,
  writeDiagnosticPack,
  buildSnapshotSummary,
  zipDirectory,
  defaultDiagnosticLogDirs
};
