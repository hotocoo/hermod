import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Devhost ports are BASE, BASE+1, BASE+2 (A, B, FRESH); same convention as playwright.config.ts. */
const BASE = Number(process.env.E2E_BASE ?? 7781);
const PORTS = [BASE, BASE + 1, BASE + 2];
const LISTENING = 'hermod-devhost listening on http://';

let running: { proc: ChildProcess; dir: string }[] = [];

/** Frees the ports, whoever holds them: a previous spec's hosts, or ones a killed worker left behind (a failed test restarts the worker without exit handlers). */
function killPorts(): void {
  for (const port of PORTS) {
    let pids: string[] = [];
    try { pids = execFileSync('lsof', ['-ti', `tcp:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' }).split('\n').filter(Boolean); } catch { /* nothing listens (lsof exits 1) */ }
    for (const pid of pids) { try { process.kill(Number(pid), 'SIGKILL'); } catch { /* already gone */ } }
  }
}

async function stopAll(): Promise<void> {
  for (const { proc, dir } of running) {
    if (proc.exitCode === null) {
      const exited = new Promise<void>((done) => { proc.once('exit', () => { done(); }); });
      proc.kill('SIGKILL');
      await exited;
    }
    rmSync(dir, { recursive: true, force: true });
  }
  running = [];
  killPorts();
}

/** Resolves once the process printed that it listens; rejects if it dies first, so a stale host on the port can never stand in for it. */
function listening(proc: ChildProcess, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { reject(new Error(`devhost on ${port} did not start in 120 s`)); }, 120_000);
    let out = '';
    proc.stdout?.on('data', (d: Buffer) => {
      out += d.toString();
      if (out.includes(LISTENING)) { clearTimeout(timer); resolve(); }
    });
    proc.once('exit', (code) => { clearTimeout(timer); reject(new Error(`devhost on ${port} exited with ${String(code)} before it listened`)); });
  });
}

function launch(port: number, dir: string): ChildProcess {
  return spawn('target/debug/hermod-devhost', ['--data-dir', dir, '--port', String(port), '--listen', '/ip4/127.0.0.1/tcp/0'], { stdio: ['ignore', 'pipe', 'ignore'] });
}

/**
 * Replaces all three devhosts with new ones: empty data dir, new identity, new database and blobs.
 * Every spec file starts from this, so no spec sees Spaces, profiles, peers or invites a former spec left,
 * and `--repeat-each` repeats start clean too. Needs `target/debug/hermod-devhost` (`npm run build:devhost`).
 */
export async function freshDevhosts(): Promise<void> {
  await stopAll();
  running = PORTS.map((port) => {
    const dir = mkdtempSync(join(tmpdir(), `hermod-e2e-${port}.`));
    return { proc: launch(port, dir), dir };
  });
  await Promise.all(running.map(({ proc }, i) => listening(proc, PORTS[i])));
}

/** Takes one devhost (index into A, B, FRESH) offline, keeping its data dir so `startDevhost` brings back the same identity. */
export async function stopDevhost(i: number): Promise<void> {
  const { proc } = running[i];
  if (proc.exitCode !== null) return;
  const exited = new Promise<void>((done) => { proc.once('exit', () => { done(); }); });
  proc.kill('SIGKILL');
  await exited;
}

/** Restarts a devhost stopped by `stopDevhost` on its old port and data dir. */
export async function startDevhost(i: number): Promise<void> {
  running[i].proc = launch(PORTS[i], running[i].dir);
  await listening(running[i].proc, PORTS[i]);
}

/** Last resort for a worker that exits normally; a killed worker is covered by `killPorts` on the next start. */
process.on('exit', () => { for (const { proc } of running) proc.kill('SIGKILL'); });
