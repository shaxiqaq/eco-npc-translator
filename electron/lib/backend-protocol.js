'use strict';

/** Shared JSON-lines protocol between Electron and Python backends. */
function parseBackendLine(line) {
  const text = String(line || '').trim();
  if (!text) return { kind: 'empty' };
  if (text.startsWith('{') || text.startsWith('[')) {
    try {
      return { kind: 'json', message: JSON.parse(text) };
    } catch {
      return { kind: 'text', text };
    }
  }
  return { kind: 'text', text };
}

function classifyTranslatorText(text) {
  if (text.includes('还没有配置翻译服务')) {
    return { state: 'error', kind: 'translator-config', message: '请先完成翻译设置' };
  }
  if (text.includes('没有运行中的 eco.exe')) {
    return { state: 'error', kind: 'no-process', message: '没有找到 eco.exe，请先进入游戏' };
  }
  if (text.includes('指定的 eco.exe 进程不存在')) {
    return { state: 'error', kind: 'process-gone', message: '所选游戏进程已经退出，请刷新后重选' };
  }
  if (/\battach\b/i.test(text)) {
    return { state: 'running' };
  }
  return null;
}

function writeCommand(child, command) {
  if (!child?.stdin?.writable) return false;
  child.stdin.write(`${JSON.stringify(command)}\n`);
  return true;
}

module.exports = {
  parseBackendLine,
  classifyTranslatorText,
  writeCommand
};
