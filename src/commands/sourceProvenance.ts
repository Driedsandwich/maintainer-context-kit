import type { GitHubSourceProvenance } from '../packet/types.ts';

type ProvenanceResult =
  | { ok: true; value: GitHubSourceProvenance }
  | { ok: false; error: string };

type ValidationResult = { ok: true } | { ok: false; error: string };

const GITHUB_PATH = /^\/([A-Za-z0-9-]{1,100})\/([A-Za-z0-9_.-]{1,100})\/(issues|pull)\/([1-9][0-9]*)\/?$/;

export function resolveGitHubSourceProvenance(
  sourceType: GitHubSourceProvenance['sourceType'],
  sourceUrl: string | undefined,
  sourceNumber: number | undefined,
): ProvenanceResult {
  if (!Number.isSafeInteger(sourceNumber) || (sourceNumber ?? 0) <= 0) {
    return { ok: false, error: 'GitHub returned no valid source number' };
  }
  if (!sourceUrl) {
    return { ok: false, error: 'GitHub returned no source URL' };
  }

  let parsed: URL;
  try {
    parsed = new URL(sourceUrl);
  } catch {
    return { ok: false, error: 'GitHub returned an invalid source URL' };
  }

  if (
    parsed.protocol !== 'https:'
    || parsed.hostname.toLowerCase() !== 'github.com'
    || parsed.username
    || parsed.password
    || parsed.port
    || parsed.search
    || parsed.hash
  ) {
    return { ok: false, error: 'GitHub returned a non-canonical source URL' };
  }

  const match = GITHUB_PATH.exec(parsed.pathname);
  const expectedPathType = sourceType === 'issue' ? 'issues' : 'pull';
  if (!match || match[3] !== expectedPathType) {
    return { ok: false, error: `GitHub returned a URL that does not identify a ${sourceType}` };
  }

  const urlNumber = Number(match[4]);
  if (urlNumber !== sourceNumber) {
    return { ok: false, error: 'GitHub returned inconsistent source URL and number metadata' };
  }

  const repository = `${match[1]}/${match[2]}`;
  return {
    ok: true,
    value: {
      sourceType,
      repository,
      number: sourceNumber,
      canonicalUrl: `https://github.com/${repository}/${expectedPathType}/${sourceNumber}`,
    },
  };
}

export function sourceLabel(provenance: GitHubSourceProvenance): string {
  const typeLabel = provenance.sourceType === 'issue' ? 'issue' : 'pull request';
  return `${provenance.repository} ${typeLabel} #${provenance.number}`;
}

export function validateExplicitSourceTarget(
  target: string,
  provenance: GitHubSourceProvenance,
): ValidationResult {
  const normalizedTarget = target.trim();
  if (!/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(normalizedTarget)) {
    return { ok: true };
  }

  const requested = resolveGitHubSourceProvenance(
    provenance.sourceType,
    normalizedTarget,
    provenance.number,
  );
  if (!requested.ok) {
    return { ok: false, error: 'Explicit target URL is not a canonical matching GitHub source URL' };
  }
  if (requested.value.canonicalUrl !== provenance.canonicalUrl) {
    return { ok: false, error: 'GitHub returned source metadata that does not match the explicit target URL' };
  }
  return { ok: true };
}
