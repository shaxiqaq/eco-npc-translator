import { spawn } from 'child_process';
import path from 'path';
import readline from 'readline';
import type { ChildProcess } from 'child_process';
import { addLog } from './state-manager';

export class XiaoYaService {
  private process: ChildProcess | null = null;
  private state = 'stopped';

  async start(gamePid: number) {
    if (this.state === 'running') return;

    this.state = 'starting';
    addLog('小雅', 'info', 启动小雅服务，连接游戏进程 );

    this.process = spawn('python', [
      '-u',
      path.join('C:\\Users\\31459\\Documents\\eco_proto\\小雅', '小雅.exe'),
      '--pid', String(gamePid),
      '--config', path.join('C:\\Users\\31459\\Documents\\eco_proto\\小雅', '小雅身体配置.ini')
    ], {
      cwd: 'electron',
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    const lines = readline.createInterface({ input: this.process.stdout });
    lines.on('line', (line) => {
      console.log([小雅] );
      addLog('小雅', 'info', line);
    });

    this.process.on('exit', (code) => {
      this.state = 'stopped';
      addLog('小雅', 'info', 小雅服务已停止（退出码: ）);
    });

    this.state = 'running';
  }

  stop() {
    if (!this.process) return;
    this.process.kill('SIGTERM');
    this.state = 'stopped';
    addLog('小雅', 'info', '小雅服务已停止');
  }

  getState() {
    return this.state;
  }
}

export default XiaoYaService;
