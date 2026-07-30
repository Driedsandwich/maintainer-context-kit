import test from 'node:test';
import assert from 'node:assert/strict';
import { maskSensitiveValue, PREFLIGHT_LIMITATION, redactSensitiveText, runPreflight } from '../src/packet/preflight.ts';

test('preflight passes clean synthetic text', () => {
  const result = runPreflight('Synthetic public-safe issue summary names the github_pat_ prefix but contains no credential.', '2026-07-02T00:00:00.000Z');

  assert.equal(result.status, 'pass');
  assert.equal(result.findings.length, 0);
  assert.equal(result.limitation, PREFLIGHT_LIMITATION);
});

test('preflight warns on email and local path patterns', () => {
  const result = runPreflight('Contact demo.user@example.test from /Users/demo/project before sharing.', '2026-07-02T00:00:00.000Z');

  assert.equal(result.status, 'warning');
  assert.ok(result.findings.some((finding) => finding.id === 'email-like'));
  assert.ok(result.findings.some((finding) => finding.id === 'private-path-like'));
});

test('preflight distinguishes formatted phone candidates from numeric identifiers and dates', () => {
  const actionUrl = 'https://github.com/example/repo/actions/runs/294412081234';
  const safeText = `Run ${actionUrl} completed on 2026-07-30.`;
  const phoneText = 'Public-safe synthetic phone fixture: +1 (202) 555-0123.';
  const safeResult = runPreflight(safeText, '2026-07-30T00:00:00.000Z');
  const phoneResult = runPreflight(phoneText, '2026-07-30T00:00:00.000Z');

  assert.equal(safeResult.findings.some((finding) => finding.id === 'phone-like'), false);
  assert.equal(redactSensitiveText(safeText), safeText);
  assert.ok(phoneResult.findings.some((finding) => finding.id === 'phone-like'));
  assert.equal(redactSensitiveText(phoneText).includes('+1 (202) 555-0123'), false);
});

test('preflight warns and redacts compact E.164 phone candidates', () => {
  const fixtures = [
    'Public-safe synthetic compact international phone fixture: +442071838750.',
    'Public-safe synthetic compact domestic phone fixture: 09012345678.',
  ];

  for (const phoneText of fixtures) {
    const result = runPreflight(phoneText, '2026-07-30T00:00:00.000Z');

    assert.ok(result.findings.some((finding) => finding.id === 'phone-like'));
    assert.notEqual(redactSensitiveText(phoneText), phoneText);
  }
});

test('preflight fully redacts bounded synthetic private local paths', () => {
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
    const source = `Before ${fixture.path}, keep this sentence and https://example.test/Users/public/docs.`;
    const result = runPreflight(source, '2026-07-16T00:00:00.000Z');
    const redacted = redactSensitiveText(source);

    assert.equal(result.status, 'warning');
    assert.ok(result.findings.some((finding) => finding.id === 'private-path-like'));
    assert.equal(result.findings.find((finding) => finding.id === 'private-path-like')?.excerpt, '[private-path]');
    assert.equal(JSON.stringify(result).includes(fixture.path), false);
    assert.equal(redacted.includes(fixture.path), false);
    for (const component of fixture.components) {
      assert.equal(JSON.stringify(result).includes(component), false);
      assert.equal(redacted.includes(component), false);
    }
    assert.match(redacted, /^Before \[private-path\], keep this sentence and https:\/\/example\.test\/Users\/public\/docs\.$/);
    assert.equal(redactSensitiveText(`Review \`${fixture.path}\` now.`), 'Review `[private-path]` now.');
    assert.equal(redactSensitiveText(`Review (${fixture.path}) now.`), 'Review ([private-path]) now.');
  }
});

test('preflight blocks synthetic GitHub-token-like values without exposing them', () => {
  const fakeToken = ['gh', 'p_', 'FAKEVALUEFAKEVALUEFAKEVALUE'].join('');
  const result = runPreflight(`token = ${fakeToken}`, '2026-07-02T00:00:00.000Z');

  assert.equal(result.status, 'blocked');
  assert.ok(result.findings.some((finding) => finding.id === 'github-token-like'));
  assert.ok(result.findings.some((finding) => finding.label === 'GitHub token-like value'));
  assert.equal(result.findings.some((finding) => finding.excerpt.includes(fakeToken)), false);
});

test('preflight blocks and redacts synthetic fine-grained GitHub-token-like values', () => {
  const fakeToken = ['github', '_pat_', 'invalid_synthetic_', 'A'.repeat(24)].join('');
  const result = runPreflight(`token = ${fakeToken}`, '2026-07-15T00:00:00.000Z');
  const redacted = redactSensitiveText(`token = ${fakeToken}`);

  assert.equal(result.status, 'blocked');
  assert.ok(result.findings.some((finding) => finding.id === 'github-fine-grained-token-like'));
  assert.ok(result.findings.some((finding) => finding.label === 'GitHub fine-grained token-like value'));
  assert.equal(JSON.stringify(result).includes(fakeToken), false);
  assert.equal(redacted.includes(fakeToken), false);
});

test('preflight warns and redacts separator-bearing synthetic credential assignments', () => {
  for (const separator of ['/', '+', '=', ':']) {
    const syntheticValue = ['invalid', separator, 'synthetic', '_value_', 'A'.repeat(12)].join('');
    const source = `api_key = "${syntheticValue}"; keep this sentence.`;
    const result = runPreflight(source, '2026-07-16T00:00:00.000Z');
    const redacted = redactSensitiveText(source);

    assert.equal(result.status, 'warning');
    assert.ok(result.findings.some((finding) => finding.id === 'credential-assignment-like'));
    assert.equal(JSON.stringify(result).includes(syntheticValue), false);
    assert.equal(redacted.includes(syntheticValue), false);
    assert.notEqual(redacted, source);
    assert.match(redacted, /; keep this sentence\.$/);
  }

  const separatorFreeValue = ['invalid', 'synthetic', 'value', 'A'.repeat(12)].join('');
  const separatorFreeSource = `token: ${separatorFreeValue}`;
  const separatorFreeResult = runPreflight(separatorFreeSource, '2026-07-16T00:00:00.000Z');

  assert.equal(separatorFreeResult.status, 'warning');
  assert.equal(redactSensitiveText(separatorFreeSource).includes(separatorFreeValue), false);
  assert.equal(runPreflight('token = use/the documented placeholder').status, 'pass');
});

test('preflight blocks synthetic private-key-like blocks without exposing them', () => {
  const fakeBlock = [
    '-----BEGIN ',
    'PRIVATE KEY-----',
    'NOT_REAL_SYNTHETIC_TEST_VALUE',
    '-----END ',
    'PRIVATE KEY-----',
  ].join('');
  const result = runPreflight(fakeBlock, '2026-07-02T00:00:00.000Z');

  assert.equal(result.status, 'blocked');
  assert.ok(result.findings.some((finding) => finding.id === 'private-key-block'));
  assert.equal(result.findings.some((finding) => finding.excerpt.includes('NOT_REAL_SYNTHETIC_TEST_VALUE')), false);
});

test('maskSensitiveValue preserves only short edges', () => {
  assert.equal(maskSensitiveValue('abcdefghijklmnop'), 'abcd…mnop');
});
