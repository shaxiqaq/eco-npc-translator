import { spawn, execFile } from 'child_process';
import readline from 'readline';
import type { ChildProcess } from 'child_process';

export class DamageService {
  private process: ChildProcess | null = null;
  private selectedPid: number | null = null;
  private state: string = 'stopped';

  async start(gamePid: number) {
    this.selectedPid = gamePid;
    this.state = 'starting';
    this.process = spawn('python', ['-u', 'src/eco_damage_bridge.py', '--pid', String(gamePid)], {
      cwd: 'electron',
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    const lines = readline.createInterface({ input: this.process.stdout });
    lines.on('line', (line) => {
      try {
        const msg = JSON.parse(line);
        this.state = msg.state || this.state;
        console.log('Damage service message:', msg.type);
      } catch (e) {
        console.log('Raw damage log:', line);
      }
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
