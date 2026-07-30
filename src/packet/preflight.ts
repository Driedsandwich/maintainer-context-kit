import type { PreflightFinding, PreflightResult, PreflightSeverity, PreflightStatus } from './types.ts';

export const PREFLIGHT_LIMITATION = 'This preflight is best-effort. It can miss secrets and can produce false positives. Do not treat a pass result as proof that the packet is safe to share publicly.';

type Detector = {
  id: string;
  label: string;
  severity: PreflightSeverity;
  pattern: RegExp;
  advice: string;
  redaction?: string;
  accept?: (match: string, context: { source: string; index: number }) => boolean;
};

const privateKeyPattern = new RegExp([
  '-----BEGIN [A-Z ]*PRIVATE KEY-----',
  '[\\s\\S]*?',
  '-----END [A-Z ]*PRIVATE KEY-----',
].join(''), 'g');

const githubTokenPattern = new RegExp(`\\b${['gh', '[pousr]_'].join('')}[A-Za-z0-9_]{20,}\\b`, 'g');
const githubFineGrainedTokenPattern = /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g;
const credentialAssignmentPattern = /\b(?:api[_-]?key|token|secret|password)\b\s*[:=]\s*['"]?[^\s,;'"`<>{}\[\]()]{12,}['"]?/gi;
const privatePathPattern = /(?<![A-Za-z0-9:/\\])(?:\/(?:Users|home)\/[A-Za-z0-9._-]+(?:\/[^\s/\\,;:'"`<>{}\[\]()!?]+)*(?<!\.)|[A-Za-z]:\\Users\\[A-Za-z0-9._-]+(?:\\[^\s/\\,;:'"`<>{}\[\]()!?]+)*(?<!\.))(?=$|[\s,;:'"`<>{}\[\]()!?.])/gi;

const DETECTORS: Detector[] = [
  {
    id: 'private-key-block',
    label: 'Private key block',
    severity: 'block',
    pattern: privateKeyPattern,
    advice: 'Remove the private key material before generating or sharing a packet.',
  },
  {
    id: 'github-token-like',
    label: 'GitHub token-like value',
    severity: 'block',
    pattern: githubTokenPattern,
    advice: 'Remove the GitHub token-like value and rotate the credential if it was real.',
  },
  {
    id: 'github-fine-grained-token-like',
    label: 'GitHub fine-grained token-like value',
    severity: 'block',
    pattern: githubFineGrainedTokenPattern,
    advice: 'Remove the GitHub fine-grained token-like value and rotate the credential if it was real.',
  },
  {
    id: 'credential-assignment-like',
    label: 'Credential assignment-like text',
    severity: 'warning',
    pattern: credentialAssignmentPattern,
    advice: 'Review the value manually. It may be a placeholder, but do not share it publicly until confirmed safe.',
  },
  {
    id: 'email-like',
    label: 'Email address-like text',
    severity: 'warning',
    pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    advice: 'Confirm whether the email address is public-safe before sharing the packet.',
  },
  {
    id: 'phone-like',
    label: 'Phone number-like text',
    severity: 'warning',
    pattern: /(?<!\d)(?:\+\d[\d\s().-]{8,}\d|\d[\d\s().-]{8,}\d)(?!\d)/g,
    advice: 'Confirm whether the phone number-like value is public-safe before sharing the packet.',
    accept: (match, context) => {
      const digits = match.replace(/\D/g, '');
      if (digits.length < 10 || digits.length > 15) {
        return false;
      }

      if (match.trim().startsWith('+') || /[\s().-]/.test(match)) {
        return true;
      }

      const prefix = context.source.slice(Math.max(0, context.index - 256), context.index);
      const insideHttpUrl = /(?:^|[\s([<'"`])https?:\/\/\S*$/i.test(prefix);
      return !insideHttpUrl;
    },
  },
  {
    id: 'private-path-like',
    label: 'Private local path-like text',
    severity: 'warning',
    pattern: privatePathPattern,
    advice: 'Review the placeholder and source context before sharing the packet.',
    redaction: '[private-path]',
  },
  {
    id: 'ip-address-like',
    label: 'IP address-like text',
    severity: 'warning',
    pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
    advice: 'Confirm whether the IP address-like value is public-safe before sharing the packet.',
  },
];

export function maskSensitiveValue(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= 8) {
    return '[masked]';
  }
  return `${normalized.slice(0, 4)}…${normalized.slice(-4)}`;
}

export function redactSensitiveText(text: string): string {
  let redacted = text;
  for (const detector of DETECTORS) {
    redacted = redacted.replace(detector.pattern, (match, ...args: unknown[]) => {
      const source = String(args.at(-1) ?? redacted);
      const index = Number(args.at(-2) ?? 0);
      if (detector.accept && !detector.accept(match, { source, index })) {
        return match;
      }
      return detector.redaction ?? maskSensitiveValue(match);
    });
  }
  return redacted;
}

function statusFromFindings(findings: readonly PreflightFinding[]): PreflightStatus {
  if (findings.some((finding) => finding.severity === 'block')) {
    return 'blocked';
  }
  if (findings.some((finding) => finding.severity === 'warning')) {
    return 'warning';
  }
  return 'pass';
}

function dedupeFindings(findings: readonly PreflightFinding[]): PreflightFinding[] {
  const seen = new Set<string>();
  const deduped: PreflightFinding[] = [];
  for (const finding of findings) {
    const key = `${finding.id}:${finding.excerpt}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(finding);
  }
  return deduped;
}

export function runPreflight(text: string, scannedAt: string = new Date().toISOString()): PreflightResult {
  const findings: PreflightFinding[] = [];

  for (const detector of DETECTORS) {
    const matches = text.matchAll(detector.pattern);
    for (const match of matches) {
      const raw = match[0] ?? '';
      if (detector.accept && !detector.accept(raw, { source: text, index: match.index ?? 0 })) {
        continue;
      }
      findings.push({
        id: detector.id,
        label: detector.label,
        severity: detector.severity,
        excerpt: detector.redaction ?? maskSensitiveValue(raw),
        advice: detector.advice,
      });
    }
  }

  const deduped = dedupeFindings(findings);

  return {
    status: statusFromFindings(deduped),
    scannedAt,
    findings: deduped,
    limitation: PREFLIGHT_LIMITATION,
  };
}
