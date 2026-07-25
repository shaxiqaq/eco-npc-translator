import { spawn } from 'child_process';

export class TranslatorService {
  private process = null;
  private state = 'stopped';

  async start(gamePid: number) {
    this.state = 'starting';
    this.process = spawn('python', ['-u', 'src/eco_npc_mitm.py', '--pid', String(gamePid)], {
      cwd: 'electron',
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    const lines = require('readline').createInterface({ input: this.process.stdout });
    lines.on('line', (line) => {
      console.log('Translator service log:', line);
      if (line.includes('attach')) this.state = 'running';
    });

    this.process.on('exit', (code) => {
      this.state = 'stopped';
    });
  }

  stop() {
    if (this.process) {
      this.process.kill();
      this.state = 'stopped';
    }
  }
}
