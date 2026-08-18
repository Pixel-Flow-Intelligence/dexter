import { describe, expect, test } from 'bun:test';

const CLI = new URL('./session-cli.ts', import.meta.url).pathname;

async function runCli(args: string[]): Promise<{ stdout: string; exitCode: number }> {
  const proc = Bun.spawn(['bun', CLI, ...args], { stdout: 'pipe', stderr: 'pipe' });
  const stdout = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;
  return { stdout: stdout.trim(), exitCode };
}

describe('session-cli', () => {
  test('resolve prints attach when last session is live', async () => {
    const result = await runCli(['resolve', '--last', 'dexter-1', '--live', 'dexter-1,dexter-2']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('attach dexter-1');
  });

  test('resolve prints create when last session is dead', async () => {
    const result = await runCli(['resolve', '--last', 'dexter-1', '--live', 'dexter-2']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('create');
  });

  test('name uses --now and avoids collisions', async () => {
    const result = await runCli([
      'name',
      '--now',
      '2026-08-18T18:04:09',
      '--existing',
      'dexter-20260818-1804',
    ]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('dexter-20260818-180409');
  });
});
