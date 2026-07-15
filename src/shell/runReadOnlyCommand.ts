import { spawnSync } from 'node:child_process';
import { classifyCommand } from './readOnlyCommandPolicy.ts';

export type ReadOnlyCommandOptions = {
  cwd?: string;
  timeoutMs?: number;
  maxOutputChars?: number;
  env?: NodeJS.ProcessEnv;
};

export type ReadOnlyCommandResult = {
  argv: string[];
  allowed: boolean;
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  truncated: boolean;
  durationMs: number;
  reason: string;
  error?: string;
};

export type ReadOnlyCommandRunner = (
  argv: readonly string[],
  options?: ReadOnlyCommandOptions,
) => ReadOnlyCommandResult;

function normalizeOutput(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (value instanceof Buffer) {
    return value.toString('utf8');
  }
  if (value == null) {
    return '';
  }
  return String(value);
}

function capOutput(value: string, maxOutputChars: number): { value: string; truncated: boolean } {
  if (value.length <= maxOutputChars) {
    return { value, truncated: false };
  }
  return {
    value: `${value.slice(0, maxOutputChars)}\n[output truncated]`,
    truncated: true,
  };
}

export function runReadOnlyCommand(
  argv: readonly string[],
  options: ReadOnlyCommandOptions = {},
): ReadOnlyCommandResult {
  const startedAt = Date.now();
  const decision = classifyCommand(argv);
  const normalizedArgv = [...argv];

  if (!decision.allowed) {
    return {
      argv: normalizedArgv,
      allowed: false,
      ok: false,
      exitCode: null,
      stdout: '',
      stderr: '',
      truncated: false,
      durationMs: Date.now() - startedAt,
      reason: decision.reason,
    };
  }

  const [command, ...args] = normalizedArgv;
  const maxOutputChars = options.maxOutputChars ?? 4000;
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    encoding: 'utf8',
    shell: false,
    timeout: options.timeoutMs ?? 5000,
    windowsHide: true,
  });

  const stdout = capOutput(normalizeOutput(result.stdout), maxOutputChars);
  const stderr = capOutput(normalizeOutput(result.stderr), maxOutputChars);
  const error = result.error ? result.error.message : undefined;

  return {
    argv: normalizedArgv,
    allowed: true,
    ok: result.status === 0 && !error,
    exitCode: typeof result.status === 'number' ? result.status : null,
    stdout: stdout.value,
    stderr: stderr.value,
    truncated: stdout.truncated || stderr.truncated,
    durationMs: Date.now() - startedAt,
    reason: decision.reason,
    error,
  };
}
