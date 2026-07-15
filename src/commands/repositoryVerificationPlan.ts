import { closeSync, constants, existsSync, fstatSync, lstatSync, openSync, readSync } from 'node:fs';
import { join } from 'node:path';

export const UNCONFIRMED_REPOSITORY_VERIFICATION = 'Use the target repository\'s documented verification commands; no local command was assumed.';
export const REPOSITORY_NPM_VERIFICATION_REQUIRES_REVIEW = 'Repository metadata declares common npm verification scripts. Inspect package.json and repository documentation before deciding which commands to run.';
export const MAX_PACKAGE_JSON_BYTES = 1024 * 1024;

const SAFE_NPM_VERIFICATION_SCRIPTS = [
  'test',
  'check',
  'lint',
  'typecheck',
  'test:unit',
  'test:integration',
  'test:e2e',
  'test:sidepanel',
  'build',
] as const;

type PackageJson = {
  packageManager?: unknown;
  scripts?: Record<string, unknown>;
};

function readBoundedPackageJson(packageJsonPath: string): PackageJson | undefined {
  let descriptor: number | undefined;
  try {
    const pathMetadata = lstatSync(packageJsonPath);
    if (!pathMetadata.isFile() || pathMetadata.size > MAX_PACKAGE_JSON_BYTES) {
      return undefined;
    }

    const noFollow = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0;
    const nonBlocking = typeof constants.O_NONBLOCK === 'number' ? constants.O_NONBLOCK : 0;
    descriptor = openSync(packageJsonPath, constants.O_RDONLY | noFollow | nonBlocking);
    const openedMetadata = fstatSync(descriptor);
    if (
      !openedMetadata.isFile()
      || openedMetadata.dev !== pathMetadata.dev
      || openedMetadata.ino !== pathMetadata.ino
      || openedMetadata.size > MAX_PACKAGE_JSON_BYTES
    ) {
      return undefined;
    }

    const buffer = Buffer.allocUnsafe(MAX_PACKAGE_JSON_BYTES + 1);
    let totalBytes = 0;
    while (totalBytes < buffer.length) {
      const bytesRead = readSync(descriptor, buffer, totalBytes, buffer.length - totalBytes, null);
      if (bytesRead === 0) {
        break;
      }
      totalBytes += bytesRead;
    }

    const finalMetadata = fstatSync(descriptor);
    if (
      totalBytes > MAX_PACKAGE_JSON_BYTES
      || totalBytes !== openedMetadata.size
      || finalMetadata.size !== openedMetadata.size
      || finalMetadata.dev !== openedMetadata.dev
      || finalMetadata.ino !== openedMetadata.ino
    ) {
      return undefined;
    }

    return JSON.parse(buffer.subarray(0, totalBytes).toString('utf8')) as PackageJson;
  } catch {
    return undefined;
  } finally {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor);
      } catch {
        // Keep filesystem details out of packet generation failures.
      }
    }
  }
}

function normalizeGitHubRepository(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.trim()
    .replace(/^git@github\.com:/i, 'https://github.com/')
    .replace(/^ssh:\/\/git@github\.com\//i, 'https://github.com/');

  try {
    const url = new URL(normalized);
    if (url.hostname.toLowerCase() !== 'github.com') {
      return undefined;
    }
    const [owner, repository] = url.pathname.replace(/^\//, '').split('/');
    if (!owner || !repository) {
      return undefined;
    }
    return `${owner}/${repository.replace(/\.git$/i, '')}`.toLowerCase();
  } catch {
    return undefined;
  }
}

export function targetMatchesLocalGitHubRepository(targetUrl: string | undefined, remoteOutput: string): boolean {
  const targetRepository = normalizeGitHubRepository(targetUrl);
  if (!targetRepository) {
    return false;
  }

  const localRepositories = remoteOutput
    .split('\n')
    .map((line) => line.trim().split(/\s+/)[1])
    .map(normalizeGitHubRepository)
    .filter((repository): repository is string => Boolean(repository));

  return localRepositories.includes(targetRepository);
}

export function repositoryNameMatchesLocalGitHubRepository(repositoryName: string | undefined, remoteOutput: string): boolean {
  if (!repositoryName || !/^[^/]+\/[^/]+$/.test(repositoryName)) {
    return false;
  }
  return targetMatchesLocalGitHubRepository(`https://github.com/${repositoryName}`, remoteOutput);
}

export function buildRepositoryVerificationSteps(
  repositoryRoot: string | undefined,
  localRepositoryConfirmed: boolean,
): string[] {
  if (!repositoryRoot || !localRepositoryConfirmed) {
    return [UNCONFIRMED_REPOSITORY_VERIFICATION];
  }

  const packageJsonPath = join(repositoryRoot, 'package.json');
  const packageJson = readBoundedPackageJson(packageJsonPath);
  if (!packageJson) {
    return [UNCONFIRMED_REPOSITORY_VERIFICATION];
  }

  if (!packageJson.scripts || typeof packageJson.scripts !== 'object' || Array.isArray(packageJson.scripts)) {
    return [UNCONFIRMED_REPOSITORY_VERIFICATION];
  }

  const npmConfirmed = typeof packageJson.packageManager === 'string'
    ? /^npm@/i.test(packageJson.packageManager)
    : existsSync(join(repositoryRoot, 'package-lock.json')) || existsSync(join(repositoryRoot, 'npm-shrinkwrap.json'));
  if (!npmConfirmed) {
    return [UNCONFIRMED_REPOSITORY_VERIFICATION];
  }

  const hasRecognizedVerificationScript = SAFE_NPM_VERIFICATION_SCRIPTS
    .some((name) => typeof packageJson.scripts?.[name] === 'string' && packageJson.scripts[name].trim().length > 0);

  return hasRecognizedVerificationScript
    ? [REPOSITORY_NPM_VERIFICATION_REQUIRES_REVIEW]
    : [UNCONFIRMED_REPOSITORY_VERIFICATION];
}
