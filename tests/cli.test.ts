import test from 'node:test';
import assert from 'node:assert/strict';
import { emitPacket, main } from '../src/cli.ts';
import { buildIssueTriagePacket, buildSyntheticTriagePacket } from '../src/commands/triage.ts';
import type { ReadOnlyCommandResult, ReadOnlyCommandRunner } from '../src/shell/runReadOnlyCommand.ts';

function ok(argv: readonly string[], stdout: string): ReadOnlyCommandResult {
  return { argv: [...argv], allowed: true, ok: true, exitCode: 0, stdout, stderr: '', truncated: false, durationMs: 1, reason: 'test command allowed' };
}

function fail(argv: readonly string[], stderr: string): ReadOnlyCommandResult {
  return { argv: [...argv], allowed: true, ok: false, exitCode: 1, stdout: '', stderr, truncated: false, durationMs: 1, reason: 'test command allowed' };
}

function fakeIssueViewRunner(body: string): ReadOnlyCommandRunner {
  return (argv) => {
    const key = argv.join(' ');
    if (argv[0] === 'gh' && argv[1] === 'issue' && argv[2] === 'view' && argv[3] === '123') {
      assert.ok(argv.includes('--jq'));
      return ok(argv, JSON.stringify({
        number: 123,
        title: 'Synthetic issue cannot run command',
        state: 'OPEN',
        author: { login: 'demo-user' },
        labels: [{ name: 'bug' }],
        body,
        comments: [{ author: { login: 'maintainer-demo' }, body: 'Can you share exact reproduction steps?', createdAt: '2026-07-02T00:00:00Z' }],
        commentCount: 1,
        createdAt: '2026-07-01T00:00:00Z',
        updatedAt: '2026-07-02T00:00:00Z',
        url: 'https://github.com/example/repo/issues/123',
      }));
    }
    return fail(argv, 'not found');
  };
}

test('version command returns the source version without running doctor output', async () => {
  let stdout = '';
  let stderr = '';
  const output = { write: (chunk: string) => { stdout += chunk; } } as NodeJS.WriteStream;
  const error = { write: (chunk: string) => { stderr += chunk; } } as NodeJS.WriteStream;

  const exitCode = await main(['--version'], output, error);

  assert.equal(exitCode, 0);
  assert.equal(stdout, '0.0.0\n');
  assert.equal(stderr, '');
});

test('cli emitter withholds blocked packet output', () => {
  const tokenLike = ['gh', 'p_', 'FAKEVALUEFAKEVALUEFAKEVALUE'].join('');
  const packet = buildIssueTriagePacket('123', {
    generatedAt: '2026-07-02T00:00:00.000Z',
    runCommand: fakeIssueViewRunner(`Steps to reproduce: paste ${tokenLike}. Actual: error.`),
  });
  let stdout = '';
  let stderr = '';

  assert.equal(packet.preflight.status, 'blocked');
  const exitCode = emitPacket(packet, (text) => { stdout += text; }, (text) => { stderr += text; });

  assert.equal(exitCode, 1);
  assert.equal(stdout, '');
  assert.match(stderr, /Preflight blocked/);
  assert.match(stderr, /output withheld/);
});

test('cli emitter withholds fine-grained GitHub-token-like issue content end to end', () => {
  const tokenLike = ['github', '_pat_', 'invalid_synthetic_', 'A'.repeat(24)].join('');
  const packet = buildIssueTriagePacket('123', {
    generatedAt: '2026-07-15T00:00:00.000Z',
    runCommand: fakeIssueViewRunner(`Steps to reproduce: paste ${tokenLike}. Actual: error.`),
  });
  let stdout = '';
  let stderr = '';

  assert.equal(packet.preflight.status, 'blocked');
  assert.ok(packet.preflight.findings.some((finding) => finding.id === 'github-fine-grained-token-like'));
  assert.equal(JSON.stringify(packet).includes(tokenLike), false);

  const exitCode = emitPacket(packet, (text) => { stdout += text; }, (text) => { stderr += text; });

  assert.equal(exitCode, 1);
  assert.equal(stdout, '');
  assert.match(stderr, /Preflight blocked/);
  assert.match(stderr, /output withheld/);
  assert.equal(stderr.includes(tokenLike), false);
});

test('cli emitter redacts separator-bearing credential assignments end to end', () => {
  const syntheticValue = ['invalid', '/', 'synthetic', '_value_', 'A'.repeat(12)].join('');
  const packet = buildIssueTriagePacket('123', {
    generatedAt: '2026-07-16T00:00:00.000Z',
    runCommand: fakeIssueViewRunner(`Steps to reproduce: set api_key = "${syntheticValue}". Actual: error.`),
  });
  let stdout = '';
  let stderr = '';

  assert.equal(packet.preflight.status, 'warning');
  assert.ok(packet.preflight.findings.some((finding) => finding.id === 'credential-assignment-like'));
  assert.equal(JSON.stringify(packet).includes(syntheticValue), false);

  const exitCode = emitPacket(packet, (text) => { stdout += text; }, (text) => { stderr += text; });

  assert.equal(exitCode, 0);
  assert.equal(stdout.includes(syntheticValue), false);
  assert.match(stdout, /Preflight: warning/);
  assert.equal(stderr, '');
});

test('cli emitter fully redacts synthetic private local paths end to end', () => {
  const fixtures = [
    {
      path: ['', ['Us', 'ers'].join(''), 'synthetic-user-macos', 'synthetic-client-macos', 'private-notes-macos.md'].join('/'),
      components: ['synthetic-user-macos', 'synthetic-client-macos', 'private-notes-macos.md'],
    },
    {
      path: ['', ['ho', 'me'].join(''), 'synthetic-user-linux', 'synthetic-project-linux', 'private-notes-linux.md'].join('/'),
      components: ['synthetic-user-linux', 'synthetic-project-linux', 'private-notes-linux.md'],
    },
    {
      path: [['C', ':'].join(''), ['Us', 'ers'].join(''), 'synthetic-user-windows', 'synthetic-case-windows', 'private-notes-windows.md'].join('\\'),
      components: ['synthetic-user-windows', 'synthetic-case-windows', 'private-notes-windows.md'],
    },
  ];

  for (const fixture of fixtures) {
    const packet = buildIssueTriagePacket('123', {
      generatedAt: '2026-07-16T00:00:00.000Z',
      runCommand: fakeIssueViewRunner(`Steps to reproduce: inspect ${fixture.path}, then keep this sentence.`),
    });
    let stdout = '';
    let stderr = '';

    assert.equal(packet.preflight.status, 'warning');
    assert.ok(packet.preflight.findings.some((finding) => finding.id === 'private-path-like'));
    assert.equal(JSON.stringify(packet).includes(fixture.path), false);

    const exitCode = emitPacket(packet, (text) => { stdout += text; }, (text) => { stderr += text; });

    assert.equal(exitCode, 0);
    assert.equal(stdout.includes(fixture.path), false);
    assert.match(stdout, /\[private-path\], then keep this sentence\./);
    assert.match(stdout, /Preflight: warning/);
    assert.equal(stderr, '');
    for (const component of fixture.components) {
      assert.equal(JSON.stringify(packet).includes(component), false);
      assert.equal(stdout.includes(component), false);
      assert.equal(stderr.includes(component), false);
    }
  }
});

test('cli emitter renders non-blocked packet output', () => {
  const packet = buildSyntheticTriagePacket('2026-07-02T00:00:00.000Z');
  let stdout = '';
  let stderr = '';

  assert.equal(packet.preflight.status, 'pass');
  const exitCode = emitPacket(packet, (text) => { stdout += text; }, (text) => { stderr += text; });

  assert.equal(exitCode, 0);
  assert.match(stdout, /# Maintainer Task Packet: triage - synthetic\/demo-repository#101/);
  assert.match(stdout, /Preflight: pass/);
  assert.equal(stderr, '');
});
