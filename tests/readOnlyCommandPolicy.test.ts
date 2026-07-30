import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyCommand, assertReadOnlyCommand } from '../src/shell/readOnlyCommandPolicy.ts';

test('allows read-only gh commands', () => {
  assert.equal(classifyCommand(['gh', 'version']).allowed, true);
  assert.equal(classifyCommand(['gh', 'auth', 'status', '--json', 'hosts']).allowed, true);
  assert.equal(classifyCommand(['gh', 'repo', 'view', '--json', 'nameWithOwner']).allowed, true);
  assert.equal(classifyCommand(['gh', 'issue', 'view', '1', '--json', 'title']).allowed, true);
  assert.equal(classifyCommand(['gh', 'pr', 'checks', '3']).allowed, true);
});

test('allows the fail-closed gh api REST GET matrix', () => {
  const allowed = [
    ['gh', 'api', '/repos/owner/repo'],
    ['gh', 'api', '-X', 'GET', '/repos/owner/repo'],
    ['gh', 'api', '-XGET', '/repos/owner/repo'],
    ['gh', 'api', '-X=GET', '/repos/owner/repo'],
    ['gh', 'api', '--method', 'GET', '/repos/owner/repo'],
    ['gh', 'api', '--method=GET', '/repos/owner/repo'],
    ['gh', 'api', '/repos/owner/repo', '--method', 'GET'],
    ['gh', 'api', '--method=get', '/repos/owner/repo'],
    ['gh', 'api', '--include', '/repos/owner/repo'],
    ['gh', 'api', '--jq', '.name', '/repos/owner/repo'],
    ['gh', 'api', '--jq=.name', '/repos/owner/repo'],
    ['gh', 'api', '--paginate', '--slurp', '/repos/owner/repo'],
    ['gh', 'api', '--preview', 'synthetic-preview', '/repos/owner/repo'],
    ['gh', 'api', '--preview=synthetic-preview', '/repos/owner/repo'],
    ['gh', 'api', '--silent', '/repos/owner/repo'],
    ['gh', 'api', '--template', '{{.name}}', '/repos/owner/repo'],
    ['gh', 'api', '--template={{.name}}', '/repos/owner/repo'],
  ];

  for (const argv of allowed) {
    assert.equal(classifyCommand(argv).allowed, true, argv.join(' '));
  }
});

test('rejects gh write commands and token-revealing flags', () => {
  assert.equal(classifyCommand(['gh', 'issue', 'comment', '1', '--body', 'x']).allowed, false);
  assert.equal(classifyCommand(['gh', 'pr', 'merge', '3']).allowed, false);
  assert.equal(classifyCommand(['gh', 'api', '--method', 'POST', '/repos/owner/repo/issues']).allowed, false);
  assert.equal(classifyCommand(['gh', 'repo', 'delete', 'owner/repo']).allowed, false);
  assert.equal(classifyCommand(['gh', 'auth', 'status', '--show-token']).allowed, false);
  assert.equal(classifyCommand(['gh', 'auth', 'status', '-t']).allowed, false);
});

test('rejects gh api request-body, GraphQL, header, verbose, and unknown flag shapes', () => {
  const disallowed = [
    ['gh', 'api', '/repos/owner/repo/issues', '-f', 'title=synthetic'],
    ['gh', 'api', '/repos/owner/repo/issues', '-ftitle=synthetic'],
    ['gh', 'api', '/repos/owner/repo/issues', '--raw-field', 'title=synthetic'],
    ['gh', 'api', '/repos/owner/repo/issues', '--raw-field=title=synthetic'],
    ['gh', 'api', '/repos/owner/repo/issues', '-F', 'title=synthetic'],
    ['gh', 'api', '/repos/owner/repo/issues', '-Ftitle=synthetic'],
    ['gh', 'api', '/repos/owner/repo/issues', '--field', 'title=synthetic'],
    ['gh', 'api', '/repos/owner/repo/issues', '--field=title=synthetic'],
    ['gh', 'api', '/repos/owner/repo/issues', '--input', 'synthetic.json'],
    ['gh', 'api', '/repos/owner/repo/issues', '--input=synthetic.json'],
    ['gh', 'api', '--method', 'GET', '/repos/owner/repo/issues', '-f', 'title=synthetic'],
    ['gh', 'api', 'graphql', '-f', 'query=mutation { synthetic }'],
    ['gh', 'api', 'graphql'],
    ['gh', 'api', '/graphql'],
    ['gh', 'api', '--verbose', '/repos/owner/repo'],
    ['gh', 'api', '-H', 'X-Synthetic: value', '/repos/owner/repo'],
    ['gh', 'api', '-HX-Synthetic:value', '/repos/owner/repo'],
    ['gh', 'api', '--header', 'X-Synthetic: value', '/repos/owner/repo'],
    ['gh', 'api', '--header=X-Synthetic:value', '/repos/owner/repo'],
    ['gh', 'api', '--unknown-flag', '/repos/owner/repo'],
    ['gh', 'api', '--cache', '1h', '/repos/owner/repo'],
    ['gh', 'api', '--hostname', 'github.example.test', '/repos/owner/repo'],
    ['gh', 'api', '-q', '.name', '/repos/owner/repo'],
    ['gh', 'api', '-i', '/repos/owner/repo'],
  ];

  for (const argv of disallowed) {
    assert.equal(classifyCommand(argv).allowed, false, argv.join(' '));
  }
});

test('rejects every non-GET gh api method spelling', () => {
  assert.equal(classifyCommand(['gh', 'api', '-X', 'POST', '/repos/owner/repo/issues']).allowed, false);
  assert.equal(classifyCommand(['gh', 'api', '-XPOST', '/repos/owner/repo/issues']).allowed, false);
  assert.equal(classifyCommand(['gh', 'api', '-X=PATCH', '/repos/owner/repo/issues/1']).allowed, false);
  assert.equal(classifyCommand(['gh', 'api', '--method=DELETE', '/repos/owner/repo/issues/1']).allowed, false);
  assert.equal(classifyCommand(['gh', 'api', '--method', 'OPTIONS', '/repos/owner/repo']).allowed, false);
  assert.equal(classifyCommand(['gh', 'api', '--method', 'GET', '--method', 'POST', '/repos/owner/repo/issues']).allowed, false);
  assert.equal(classifyCommand(['gh', 'api', '--method', 'POST', '--method', 'GET', '/repos/owner/repo/issues']).allowed, false);
  assert.equal(classifyCommand(['gh', 'api', '--method']).allowed, false);
  assert.equal(classifyCommand(['gh', 'api', '-X']).allowed, false);
  assert.equal(classifyCommand(['gh', 'api', '-X', 'HEAD', '/repos/owner/repo']).allowed, false);
});

test('rejects incomplete or ambiguous gh api argv', () => {
  const disallowed = [
    ['gh', 'api'],
    ['gh', 'api', '/repos/owner/repo', 'extra'],
    ['gh', 'api', '--method', 'GET'],
    ['gh', 'api', '--jq', '/repos/owner/repo'],
    ['gh', 'api', '--preview', '/repos/owner/repo'],
    ['gh', 'api', '--template', '/repos/owner/repo'],
  ];

  for (const argv of disallowed) {
    assert.equal(classifyCommand(argv).allowed, false, argv.join(' '));
  }
});

test('allows only the exact product Git command matrix', () => {
  const allowed = [
    ['git', 'version'],
    ['git', 'rev-parse', '--show-toplevel'],
    ['git', 'branch', '--show-current'],
    ['git', 'status', '--short'],
    ['git', 'remote', '-v'],
  ];

  for (const argv of allowed) {
    assert.equal(classifyCommand(argv).allowed, true, argv.join(' '));
  }
});

test('rejects git write or state-changing commands', () => {
  assert.equal(classifyCommand(['git', 'push']).allowed, false);
  assert.equal(classifyCommand(['git', 'commit', '-m', 'x']).allowed, false);
  assert.equal(classifyCommand(['git', 'checkout', '-b', 'x']).allowed, false);
});

test('rejects unneeded Git argument variants under otherwise read-only subcommands', () => {
  const disallowed = [
    ['git', 'branch', '-D', 'synthetic'],
    ['git', 'remote', 'set-url', 'origin', 'https://example.invalid/repo.git'],
    ['git', 'diff', '--output=synthetic.diff'],
    ['git', 'status'],
    ['git', 'remote'],
    ['git', 'log', '--oneline'],
  ];

  for (const argv of disallowed) {
    assert.equal(classifyCommand(argv).allowed, false, argv.join(' '));
  }
});

test('assertReadOnlyCommand throws for disallowed commands', () => {
  assert.doesNotThrow(() => assertReadOnlyCommand(['gh', 'repo', 'view']));
  assert.throws(() => assertReadOnlyCommand(['gh', 'issue', 'create']));
});
