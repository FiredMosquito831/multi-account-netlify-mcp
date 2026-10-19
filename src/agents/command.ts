import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface CommandOptions {
  cwd?: string;
}

// Runs a command with fixed arguments and no shell. The only exception is a Windows .cmd shim, which
// Node cannot start directly; it goes through cmd.exe with every argument checked first.
export type Runner = (command: string, args: readonly string[], options?: CommandOptions) => Promise<CommandResult>;

export interface ResolvedCommand {
  file: string;
  viaCmd: boolean;
}

// Where a command lives. On Windows npm installs codex and opencode as .cmd files next to a sh script,
// and only .exe files can be started without a shell, so an .exe is preferred when there is one.
export const resolveCommand = (name: string): ResolvedCommand | undefined => {
  if (process.platform !== 'win32') {
    for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
      const file = path.join(dir, name);
      if (dir !== '' && existsSync(file)) {
        return { file, viaCmd: false };
      }
    }
    return undefined;
  }
  const found = spawnSync('where.exe', [name], { encoding: 'utf8', windowsHide: true })
    .stdout.split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');
  const exe = found.find((file) => /\.exe$/i.test(file));
  if (exe) {
    return { file: exe, viaCmd: false };
  }
  const script = found.find((file) => /\.(cmd|bat)$/i.test(file));
  return script ? { file: script, viaCmd: true } : undefined;
};

// cmd.exe reads quotes and % and line breaks specially, so an argument containing them is refused.
const quoteForCmd = (arg: string): string => {
  if (/["%\r\n]/.test(arg)) {
    throw new Error(`An argument cannot be passed through cmd.exe: ${arg}`);
  }
  return `"${arg}"`;
};

export const runCommand: Runner = (command, args, options = {}) =>
  new Promise((resolve) => {
    const resolved = resolveCommand(command);
    if (!resolved) {
      resolve({ code: 127, stdout: '', stderr: `${command} is not on PATH` });
      return;
    }
    const child = resolved.viaCmd
      ? spawn('cmd.exe', ['/d', '/s', '/c', `"${[resolved.file, ...args].map(quoteForCmd).join(' ')}"`], {
          cwd: options.cwd,
          windowsHide: true,
          windowsVerbatimArguments: true,
          shell: false,
        })
      : spawn(resolved.file, [...args], { cwd: options.cwd, windowsHide: true, shell: false });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString('utf8')));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')));
    child.on('error', (error) => resolve({ code: 1, stdout, stderr: `${stderr}${error.message}` }));
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });

export const isPresent = (command: string): boolean => resolveCommand(command) !== undefined;
