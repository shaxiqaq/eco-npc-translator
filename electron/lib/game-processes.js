const { execFile } = require('child_process');

const POWERSHELL_SCRIPT = [
  '[Console]::OutputEncoding = [Text.Encoding]::UTF8',
  '$items = @(Get-Process -Name eco -ErrorAction SilentlyContinue | Sort-Object Id | ForEach-Object {',
  '  $started = $null',
  '  try { $started = $_.StartTime.ToString("HH:mm:ss") } catch {}',
  '  [pscustomobject]@{ pid = $_.Id; title = $_.MainWindowTitle; started = $started }',
  '})',
  'ConvertTo-Json -InputObject $items -Compress'
].join('; ');

function normalizeGameProcesses(value) {
  const items = Array.isArray(value) ? value : value ? [value] : [];
  return items
    .map((item) => ({
      pid: Number(item?.pid),
      title: String(item?.title || '').trim(),
      started: String(item?.started || '').trim()
    }))
    .filter((item) => Number.isInteger(item.pid) && item.pid > 0)
    .sort((left, right) => left.pid - right.pid);
}

function parseGameProcesses(stdout) {
  const text = String(stdout || '').replace(/^\uFEFF/, '').trim();
  if (!text) return [];
  return normalizeGameProcesses(JSON.parse(text));
}

function listGameProcesses(execFileFn = execFile) {
  if (process.platform !== 'win32') return Promise.resolve([]);
  return new Promise((resolve, reject) => {
    execFileFn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', POWERSHELL_SCRIPT],
      { windowsHide: true, encoding: 'utf8', maxBuffer: 1024 * 1024 },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        try {
          resolve(parseGameProcesses(stdout));
        } catch (parseError) {
          reject(parseError);
        }
      }
    );
  });
}

module.exports = {
  listGameProcesses,
  normalizeGameProcesses,
  parseGameProcesses
};
