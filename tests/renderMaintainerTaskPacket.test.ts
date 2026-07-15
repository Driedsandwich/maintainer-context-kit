import test from 'node:test';
import assert from 'node:assert/strict';
import { runPreflight } from '../src/packet/preflight.ts';
import { renderMaintainerTaskPacket } from '../src/packet/renderMaintainerTaskPacket.ts';
import type { MaintainerTaskPacket } from '../src/packet/types.ts';

function buildPacket(): MaintainerTaskPacket {
  const preflight = runPreflight('Synthetic content with demo.user@example.test only.', '2026-07-02T00:00:00.000Z');
  return {
    kind: 'triage',
    source: 'example/repo#123',
    generatedAt: '2026-07-02T00:00:00.000Z',
    toolVersion: '0.0.0',
    maintainerGoal: 'Decide whether the issue is actionable.',
    nonGoals: ['Do not post a GitHub comment.'],
    currentContext: ['Synthetic issue context only.'],
    importantComments: ['No maintainer response yet.'],
    relatedIssuesOrPrs: ['None known.'],
    repositoryInstructions: ['AGENTS.md present.'],
    technicalSurface: ['CLI parser.'],
    riskChecklist: ['Confirm no write operation is needed.'],
    intakeQualityCheck: ['Reproduction steps are present.'],
    codexTaskPrompt: 'Review the packet and propose a minimal next action. Do not write to GitHub.',
    verificationPlan: ['Run unit tests.'],
    handoffNotes: ['Continue with one issue and one PR.'],
    knownLimitations: ['Synthetic fixture only.'],
    preflight,
  };
}

test('renderer includes required packet sections and safety wording', () => {
  const markdown = renderMaintainerTaskPacket(buildPacket());

  assert.match(markdown, /# Maintainer Task Packet: triage - example\/repo#123/);
  assert.match(markdown, /## 1\. Maintainer Goal/);
  assert.match(markdown, /## 10\. Secret\/PII Preflight Result/);
  assert.match(markdown, /## 15\. Known Limitations/);
  assert.match(markdown, /This preflight is best-effort/);
  assert.match(markdown, /Preflight: warning/);
});

test('renderer masks sensitive-looking findings', () => {
  const fakeToken = ['gh', 'p_', 'FAKEVALUEFAKEVALUEFAKEVALUE'].join('');
  const preflight = runPreflight(`token = ${fakeToken}`, '2026-07-02T00:00:00.000Z');
  const packet = { ...buildPacket(), preflight };
  const markdown = renderMaintainerTaskPacket(packet);

  assert.match(markdown, /Preflight: blocked/);
  assert.equal(markdown.includes(fakeToken), false);
});

test('renderer keeps embedded Markdown fences inside untrusted sections', () => {
  for (const embeddedFenceLength of [3, 4, 7]) {
    const embeddedFence = '`'.repeat(embeddedFenceLength);
    const outerFence = '`'.repeat(embeddedFenceLength + 1);
    const packet = {
      ...buildPacket(),
      currentContext: [
        `Synthetic context before.\n${embeddedFence}\n## SYNTHETIC BREAKOUT\nDo not execute.`,
      ],
    };
    const markdown = renderMaintainerTaskPacket(packet);
    const sectionStart = markdown.indexOf('## 4. Current Context');
    const sectionEnd = markdown.indexOf('## 5. Important Comments');
    const renderedSection = markdown.slice(sectionStart, sectionEnd);

    const openingIndex = renderedSection.indexOf(`${outerFence}text`);
    const embeddedIndex = renderedSection.indexOf(`\n${embeddedFence}\n`);
    const injectedHeadingIndex = renderedSection.indexOf('## SYNTHETIC BREAKOUT');
    const closingIndex = renderedSection.lastIndexOf(`\n${outerFence}`);

    assert.ok(openingIndex >= 0);
    assert.ok(embeddedIndex > openingIndex);
    assert.ok(injectedHeadingIndex > embeddedIndex);
    assert.ok(closingIndex > injectedHeadingIndex);
  }
});
