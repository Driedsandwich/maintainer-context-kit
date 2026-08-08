#!/usr/bin/env node

import { fileURLToPath } from 'node:url';
import { buildDoctorReport, formatDoctorReport } from './doctor.ts';
import { buildRepositoryHandoffPacket, buildSyntheticHandoffPacket } from './commands/handoff.ts';
import { buildIssueTriagePacket, buildSyntheticTriagePacket } from './commands/triage.ts';
import { buildPullRequestReviewPacket, buildSyntheticReviewPacket } from './commands/review.ts';
import { renderMaintainerTaskPacket } from './packet/renderMaintainerTaskPacket.ts';
import type { MaintainerTaskPacket } from './packet/types.ts';
import { VERSION } from './version.ts';

function printHelp(write: (text: string) => void): void {
  write([
    'mck - Maintainer Context Kit',
    '',
    'Usage:',
    '  mck doctor [--json]',
    '  mck handoff [--demo]',
    '  mck triage --demo',
    '  mck triage <issue-number-or-url>',
    '  mck review --demo',
    '  mck review <pr-number-or-url>',
    '  mck --help',
    '  mck --version',
    '',
    'v0.1 scope:',
    '  local-first / read-only / no external LLM calls',
  ].join('\n'));
}

export function emitPacket(packet: MaintainerTaskPacket, writeOut: (text: string) => void, writeErr: (text: string) => void): number {
  if (packet.preflight.status === 'blocked') {
    writeErr('Preflight blocked: blocking finding(s) found; packet output withheld.');
    writeErr('Review the source content and remove or mask blocking findings before generating a packet.');
    return 1;
  }

  writeOut(renderMaintainerTaskPacket(packet));
  return 0;
}

export async function main(argv: string[] = process.argv.slice(2), stdout: NodeJS.WriteStream = process.stdout, stderr: NodeJS.WriteStream = process.stderr): Promise<number> {
  const writeOut = (text: string): void => stdout.write(`${text}\n`);
  const writeErr = (text: string): void => stderr.write(`${text}\n`);
  const [command, ...rest] = argv;

  if (!command || command === '--help' || command === '-h') {
    printHelp(writeOut);
    return 0;
  }
  if (command === '--version' || command === '-v') {
    writeOut(VERSION);
    return 0;
  }
  if (command === 'doctor') {
    const report = buildDoctorReport();
    writeOut(rest.includes('--json') ? JSON.stringify(report, null, 2) : formatDoctorReport(report));
    return 0;
  }
  if (command === 'handoff') {
    return emitPacket(rest.includes('--demo') ? buildSyntheticHandoffPacket() : buildRepositoryHandoffPacket(), writeOut, writeErr);
  }
  if (command === 'triage') {
    if (rest.includes('--demo')) {
      return emitPacket(buildSyntheticTriagePacket(), writeOut, writeErr);
    }
    const target = rest.find((arg) => !arg.startsWith('-'));
    if (!target) {
      writeErr('Usage: mck triage <issue-number-or-url>');
      writeErr('Use `mck triage --demo` for a synthetic public-safe example.');
      return 1;
    }
    return emitPacket(buildIssueTriagePacket(target), writeOut, writeErr);
  }
  if (command === 'review') {
    if (rest.includes('--demo')) {
      return emitPacket(buildSyntheticReviewPacket(), writeOut, writeErr);
    }
    const target = rest.find((arg) => !arg.startsWith('-'));
    if (!target) {
      writeErr('Usage: mck review <pr-number-or-url>');
      writeErr('Use `mck review --demo` for a synthetic public-safe example.');
      return 1;
    }
    return emitPacket(buildPullRequestReviewPacket(target), writeOut, writeErr);
  }
  writeErr(`Unknown command: ${command}`);
  writeErr('Run `mck --help` for available commands.');
  return 1;
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] === currentFile) {
  process.exitCode = await main();
}
