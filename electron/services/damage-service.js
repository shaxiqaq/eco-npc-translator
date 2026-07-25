const { spawn, execFile } = require('child_process');
const readline = require('readline');
const path = require('path');
const fs = require('fs');

class DamageService {
  constructor() {
    this.process = null;
    this.selectedPid = null;
    this.state = 'stopped';
  }

  async start(gamePid) {
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
        console.log('Damage service message:', msg.type, msg.state);
        this.state = msg.state || this.state;
      } catch (e) {
        console.log('Raw damage log:', line);
      }
    });

    this.process.on('exit', (code) => {
      this.state = 'stopped';
      console.log('Damage service exited with code', code);
    });
  }

  stop() {
    if (this.process) {
      this.process.kill();
      this.state = 'stopped';
    }
  }
}

module.exports = DamageService;
