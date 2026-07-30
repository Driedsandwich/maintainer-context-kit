export type CommandDecision = {
  allowed: boolean;
  reason: string;
  category?: string;
};

const READ_ONLY_GIT_COMMANDS = new Set([
  ['git', 'version'],
  ['git', 'rev-parse', '--show-toplevel'],
  ['git', 'branch', '--show-current'],
  ['git', 'status', '--short'],
  ['git', 'remote', '-v'],
].map((argv) => argv.join('\0')));

const READ_ONLY_GH_PAIRS = new Set([
  'auth status',
  'repo view',
  'repo list',
  'issue view',
  'issue list',
  'pr view',
  'pr list',
  'pr diff',
  'pr checks',
  'run list',
  'run view',
  'release view',
  'release list',
]);

const READ_ONLY_GH_SINGLE_COMMANDS = new Set([
  'version',
  '--version',
]);

const WRITE_GH_PAIRS = new Set([
  'issue create',
  'issue edit',
  'issue comment',
  'issue close',
  'issue reopen',
  'pr create',
  'pr edit',
  'pr comment',
  'pr review',
  'pr merge',
  'pr close',
  'release create',
  'release edit',
  'release delete',
  'label create',
  'label edit',
  'label delete',
  'repo create',
  'repo edit',
  'repo delete',
]);

const GH_API_REQUEST_BODY_FLAGS = new Set([
  '-f',
  '--raw-field',
  '-F',
  '--field',
  '--input',
]);

const GH_API_SAFE_BOOLEAN_FLAGS = new Set([
  '--include',
  '--paginate',
  '--silent',
  '--slurp',
]);

const GH_API_SAFE_VALUE_FLAGS = new Set([
  '--jq',
  '--preview',
  '--template',
]);

function rejectGhApi(reason: string): CommandDecision {
  return { allowed: false, reason: `gh api ${reason} by the v0.1 read-only policy.` };
}

function hasGhApiRequestBodyFlag(arg: string): boolean {
  return GH_API_REQUEST_BODY_FLAGS.has(arg)
    || arg.startsWith('--raw-field=')
    || arg.startsWith('--field=')
    || arg.startsWith('--input=')
    || /^-[fF].+/.test(arg);
}

function classifyGhApi(args: readonly string[]): CommandDecision {
  const methods: string[] = [];
  const endpoints: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--method' || arg === '-X') {
      const value = args[index + 1];
      if (!value || value.startsWith('-')) {
        return rejectGhApi(`${arg} requires a method value and is rejected`);
      }
      methods.push(value.toUpperCase());
      index += 1;
      continue;
    }

    if (arg.startsWith('--method=')) {
      const value = arg.slice('--method='.length);
      if (!value) {
        return rejectGhApi('--method requires a method value and is rejected');
      }
      methods.push(value.toUpperCase());
      continue;
    }

    if (arg.startsWith('-X') && arg.length > 2) {
      const value = arg.slice(2).replace(/^=/, '');
      if (!value) {
        return rejectGhApi('-X requires a method value and is rejected');
      }
      methods.push(value.toUpperCase());
      continue;
    }

    if (hasGhApiRequestBodyFlag(arg)) {
      return rejectGhApi(`request-body flag ${arg} is rejected`);
    }

    if (arg === '--verbose' || arg.startsWith('--verbose=')) {
      return rejectGhApi('--verbose is rejected');
    }

    if (arg === '-H' || arg === '--header' || /^-H.+/.test(arg) || arg.startsWith('--header=')) {
      return rejectGhApi(`custom header flag ${arg} is rejected`);
    }

    if (GH_API_SAFE_BOOLEAN_FLAGS.has(arg)) {
      continue;
    }

    const safeValueFlag = [...GH_API_SAFE_VALUE_FLAGS].find((flag) => arg === flag || arg.startsWith(`${flag}=`));
    if (safeValueFlag) {
      if (arg === safeValueFlag) {
        const value = args[index + 1];
        if (!value || value.startsWith('-')) {
          return rejectGhApi(`${safeValueFlag} requires a value and is rejected`);
        }
        index += 1;
      } else if (!arg.slice(safeValueFlag.length + 1)) {
        return rejectGhApi(`${safeValueFlag} requires a value and is rejected`);
      }
      continue;
    }

    if (arg.startsWith('-')) {
      return rejectGhApi(`unknown flag ${arg} is rejected`);
    }

    endpoints.push(arg);
  }

  const nonGetMethod = methods.find((method) => method !== 'GET');
  if (nonGetMethod !== undefined) {
    return rejectGhApi(`method ${nonGetMethod || '(missing method)'} is rejected`);
  }

  if (endpoints.length !== 1) {
    return rejectGhApi(`requires exactly one REST endpoint; received ${endpoints.length}`);
  }

  const [endpoint] = endpoints;
  if (endpoint === 'graphql' || endpoint === '/graphql') {
    return rejectGhApi('GraphQL endpoint is rejected');
  }

  return { allowed: true, category: 'gh:api:read', reason: 'gh api REST GET is allowed by the v0.1 read-only policy.' };
}

function hasForbiddenGhAuthTokenFlag(args: readonly string[]): boolean {
  return args[1] === 'auth'
    && args[2] === 'status'
    && (args.includes('--show-token') || args.includes('-t'));
}

export function classifyCommand(argv: readonly string[]): CommandDecision {
  const [binary, subcommand, nested] = argv;

  if (!binary) {
    return { allowed: false, reason: 'Empty command is not allowed.' };
  }

  if (binary === 'git') {
    if (!subcommand) {
      return { allowed: false, reason: 'git command must include a subcommand.' };
    }
    if (READ_ONLY_GIT_COMMANDS.has(argv.join('\0'))) {
      return {
        allowed: true,
        category: 'git:read',
        reason: `Exact git ${subcommand} command shape is allowed.`,
      };
    }
    return {
      allowed: false,
      reason: `git ${subcommand} arguments are not in the exact read-only allowlist.`,
    };
  }

  if (binary === 'gh') {
    if (!subcommand) {
      return { allowed: false, reason: 'gh command must include a subcommand.' };
    }

    if (hasForbiddenGhAuthTokenFlag(argv)) {
      return { allowed: false, reason: 'gh token-revealing flags are not allowed.' };
    }

    if (READ_ONLY_GH_SINGLE_COMMANDS.has(subcommand)) {
      return { allowed: true, category: 'gh:read', reason: `gh ${subcommand} is allowed.` };
    }

    if (subcommand === 'api') {
      return classifyGhApi(argv.slice(2));
    }

    const pair = `${subcommand} ${nested ?? ''}`.trim();
    if (WRITE_GH_PAIRS.has(pair)) {
      return { allowed: false, reason: `gh ${pair} is not read-only.` };
    }
    if (READ_ONLY_GH_PAIRS.has(pair)) {
      return { allowed: true, category: 'gh:read', reason: `gh ${pair} is allowed.` };
    }
    return { allowed: false, reason: `gh ${pair} is not in the read-only allowlist.` };
  }

  return { allowed: false, reason: `${binary} is not an allowed command binary.` };
}

export function assertReadOnlyCommand(argv: readonly string[]): void {
  const decision = classifyCommand(argv);
  if (!decision.allowed) {
    throw new Error(decision.reason);
  }
}
