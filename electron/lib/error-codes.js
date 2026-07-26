'use strict';

/**
 * Stable, searchable error codes for remote support.
 * Prefer including [ECO_Exx] in user-visible messages.
 */
const ERROR_CATALOG = {
  ECO_E01: {
    title: '无游戏进程',
    hint: '请启动并登录 ECO，刷新顶部进程列表后选择角色窗口。'
  },
  ECO_E02: {
    title: '进程已退出',
    hint: '所选 eco.exe 已关闭。刷新列表重选，或点「重新连接」。'
  },
  ECO_E03: {
    title: '权限不足',
    hint: '请右键以管理员身份运行 ECO 工具箱后重试挂接。'
  },
  ECO_E04: {
    title: 'Frida 挂接失败',
    hint: '确认 PID 正确；多开时勿选错角色。仍失败请复制诊断信息。'
  },
  ECO_E05: {
    title: '后端脚本缺失',
    hint: '开发模式请确认 src 下 bridge 脚本存在；安装版请重装工具箱。'
  },
  ECO_E06: {
    title: '翻译未配置',
    hint: '请先在设置 → 翻译服务中填写 API 或本地服务。'
  },
  ECO_E07: {
    title: '后端启动失败',
    hint: '查看运行日志中的详细错误；可尝试导出日志。'
  },
  ECO_E08: {
    title: '进程枚举失败',
    hint: '无法读取 eco.exe 列表。检查杀软拦截或重开工具箱。'
  },
  ECO_E09: {
    title: '未知错误',
    hint: '请复制诊断信息以便排查。'
  }
};

function stripExistingCode(message) {
  return String(message || '').replace(/^\s*\[ECO_E\d{2}\]\s*/i, '').trim();
}

function withErrorCode(message, code) {
  const text = stripExistingCode(message);
  const normalized = String(code || '').toUpperCase();
  if (!normalized || !ERROR_CATALOG[normalized]) {
    return text;
  }
  return `[${normalized}] ${text}`;
}

/**
 * Classify free-text / context into a stable code.
 * @param {string} message
 * @param {{ kind?: string }} [context]
 */
function classifyError(message, context = {}) {
  const text = stripExistingCode(message);
  const lower = text.toLowerCase();
  const kind = String(context.kind || '');

  if (kind === 'no-process' || /没有可用的游戏进程|没有可用的 eco|没有运行中的 eco|请启动游戏/.test(text)) {
    return pack('ECO_E01', text);
  }
  if (kind === 'process-gone' || /已不在列表|进程不存在|已退出|指定的进程不存在/.test(text)) {
    return pack('ECO_E02', text);
  }
  if (
    kind === 'access'
    || /access|denied|权限|administrator|管理员/.test(lower)
    || /权限/.test(text)
  ) {
    return pack('ECO_E03', text);
  }
  if (kind === 'script-missing' || /找不到后端脚本|enoent/.test(lower)) {
    return pack('ECO_E05', text);
  }
  if (kind === 'translator-config' || /还没有配置翻译|翻译设置/.test(text)) {
    return pack('ECO_E06', text);
  }
  if (kind === 'enumerate' || /读取游戏进程失败|无法枚举/.test(text)) {
    return pack('ECO_E08', text);
  }
  if (/没有找到 eco|frida|attach|挂接|连接进程/.test(lower) || /连接进程|没有找到/.test(text)) {
    return pack('ECO_E04', text);
  }
  if (kind === 'spawn' || /spawn|启动失败|eacces|eperm/.test(lower)) {
    return pack('ECO_E07', text);
  }
  return pack('ECO_E09', text || '发生未知错误');
}

function pack(code, message) {
  const meta = ERROR_CATALOG[code] || ERROR_CATALOG.ECO_E09;
  return {
    code,
    title: meta.title,
    hint: meta.hint,
    message: withErrorCode(message || meta.title, code),
    raw: stripExistingCode(message)
  };
}

function parseErrorCode(message) {
  const match = String(message || '').match(/\[(ECO_E\d{2})\]/i);
  return match ? match[1].toUpperCase() : null;
}

module.exports = {
  ERROR_CATALOG,
  classifyError,
  withErrorCode,
  parseErrorCode,
  stripExistingCode
};
