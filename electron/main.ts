import { app, BrowserWindow, ipcMain, shell, screen } from 'electron';
import { autoUpdater } from 'electron-updater';
import { spawn, execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import readline from 'readline';

import { listGameProcesses } from './lib/game-processes';
import { mergeDeep, readJson, writeJson } from './lib/json-store';
import { SkillIconService } from './lib/skill-icons';
import { UpdateService, initialUpdateState } from './lib/update-service';

import StateManager from './services/state-manager';
import { DamageService } from './services/damage-service';
import { TranslatorService } from './services/translator-service';
import { OverlayService } from './services/overlay-service';

const isDemo = process.env.ECO_UI_DEMO === '1';

const stateManager = new StateManager();
const damageService = new DamageService();
const translatorService = new TranslatorService();
const overlayService = new OverlayService();
const xiaoYaService = new (require('./services/xiao-ya-service').default)(); // 替换成你的实际导入方式

let mainWindow: BrowserWindow | null = null;
let overlayWindow: BrowserWindow | null = null;
let latestSnapshot: any = null;
let overlayEditing = false;
let demoTimer: NodeJS.Timeout | null = null;
let gameProcesses: any[] = [];
let selectedGamePid: number | null = null;
let updateService: UpdateService | null = null;
let skillIconService: SkillIconService | null = null;

// Helper functions for service delegation
function getService(name: string) {
  if (name === 'damage') return damageService;
  if (name === 'translator') return translatorService;
  return null;
}

async function startService(name: string) {
  const service = getService(name);
  if (!service) return { ok: false, error: 'Unknown service' };
  if (service.state === 'running') return { ok: true };

  if (!selectedGamePid) {
    const error = '没有可用的 eco.exe，请启动游戏并刷新进程列表';
    return { ok: false, error };
  }
  if (isDemo && name === 'damage') {
    startDemo();
    return { ok: true };
  }

  setServiceState(name, 'starting', '正在启动');
  addLog(name, 'info', `启动 ${name} 服务，连接游戏进程 ${selectedGamePid}`);

  try {
    await service.start(selectedGamePid);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

async function stopService(name: string) {
  const service = getService(name);
  if (!service) return { ok: false, error: 'Unknown service' };
  try {
    service.stop();
    setServiceState(name, 'stopped', '已停止');
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

// ... (rest of the code would go here, but for now this is the structure)
