'use strict';

const SERVICE_LABELS = {
  damage: '伤害采集',
  monitoring: '状态监控',
  translator: 'NPC 翻译',
  xiaoya: '小雅助手',
  buffs: '状态监控',
  app: '应用',
  update: '更新'
};

function serviceLabel(service) {
  return SERVICE_LABELS[service] || service || '未知';
}

function filterLogs(logs, filter = 'all') {
  const key = String(filter || 'all');
  if (!key || key === 'all') return (logs || []).slice();
  return (logs || []).filter((entry) => {
    if (entry.service === key) return true;
    if (Array.isArray(entry.channels) && entry.channels.includes(key)) return true;
    if (key === 'monitoring' && (entry.service === 'buffs' || entry.service === 'monitoring')) return true;
    return false;
  });
}

function formatLogsExportBody(selected, { filter, format }) {
  if (format === 'json') {
    return `${JSON.stringify({
      exportedAt: new Date().toISOString(),
      filter,
      count: selected.length,
      logs: selected
    }, null, 2)}\n`;
  }
  const header = [
    '# ECO 工具箱运行日志导出',
    `# 时间: ${new Date().toLocaleString('zh-CN', { hour12: false })}`,
    `# 筛选: ${filter}`,
    `# 条数: ${selected.length}`,
    ''
  ].join('\n');
  return header + selected.map((entry) => {
    const level = entry.level || 'info';
    const service = serviceLabel(entry.service);
    return `[${entry.time || '--:--:--'}] [${service}] [${level}] ${entry.message || ''}`;
  }).join('\n') + '\n';
}

function createLogRing({ capacity = 1000, onEntry } = {}) {
  const logs = [];

  function add(service, level, message, options = {}) {
    const primary = String(service || 'app');
    const also = Array.isArray(options.also) ? options.also.map(String).filter(Boolean) : [];
    const channels = [...new Set([primary, ...also])];
    const entry = {
      time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
      service: primary,
      channels,
      level,
      message
    };
    logs.push(entry);
    if (logs.length > capacity) logs.splice(0, logs.length - capacity);
    if (onEntry) onEntry(entry);
    return entry;
  }

  function slice(n = 300) {
    return logs.slice(-n);
  }

  function all() {
    return logs;
  }

  function filtered(filter) {
    return filterLogs(logs, filter);
  }

  return {
    add,
    slice,
    all,
    filtered,
    logs
  };
}

module.exports = {
  SERVICE_LABELS,
  serviceLabel,
  filterLogs,
  formatLogsExportBody,
  createLogRing
};
