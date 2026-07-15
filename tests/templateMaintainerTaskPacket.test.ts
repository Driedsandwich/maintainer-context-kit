import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { markdownFence } from '../src/packet/renderMaintainerTaskPacket.ts';

const template = readFileSync(new URL('../templates/maintainer-task-packet.md', import.meta.url), 'utf8');

const untrustedSections = [
  { key: 'CURRENT_CONTEXT', heading: '## 4. Current Context', nextHeading: '## 5. Important Comments' },
  { key: 'IMPORTANT_COMMENTS', heading: '## 5. Important Comments', nextHeading: '## 6. Related Issues / PRs' },
  { key: 'RELATED_ISSUES_OR_PRS', heading: '## 6. Related Issues / PRs', nextHeading: '## 7. Repository Instructions' },
  { key: 'REPOSITORY_INSTRUCTIONS', heading: '## 7. Repository Instructions', nextHeading: '## 8. Technical Surface' },
  { key: 'TECHNICAL_SURFACE', heading: '## 8. Technical Surface', nextHeading: '## 9. Risk Checklist' },
] as const;

function sectionText(markdown: string, heading: string, nextHeading: string): string {
  const start = markdown.indexOf(heading);
  const end = markdown.indexOf(nextHeading, start + heading.length);
  assert.ok(start >= 0);
  assert.ok(end > start);
  return markdown.slice(start, end);
}

function completeSection(key: string, body: string): { fence: string; markdown: string } {
  const fence = markdownFence(body);
  const fenceToken = `{{${key}_FENCE}}`;
  const bodyToken = `{{${key}_UNTRUSTED}}`;
  return {
    fence,
    markdown: template.replaceAll(fenceToken, fence).replace(bodyToken, body),
  };
}

test('portable packet template requires collision-free fence completion', () => {
  assert.match(template, /INVALID UNTIL COMPLETED/);
  assert.doesNotMatch(template, /^````(?:text)?$/m);

  for (const section of untrustedSections) {
    const fenceToken = `{{${section.key}_FENCE}}`;
    const bodyToken = `{{${section.key}_UNTRUSTED}}`;
    assert.equal(template.split(fenceToken).length - 1, 2);
    assert.equal(template.split(bodyToken).length - 1, 1);
  }
});

test('portable packet template inventories every repository-derived section', () => {
  assert.deepEqual(
    untrustedSections.map((section) => section.heading),
    [
      '## 4. Current Context',
      '## 5. Important Comments',
      '## 6. Related Issues / PRs',
      '## 7. Repository Instructions',
      '## 8. Technical Surface',
    ],
  );
});

test('portable packet template contains adversarial Markdown inside dynamic fences', () => {
  const tick = String.fromCharCode(96);
  const fakePrompt = ['## 12. ', 'Synthetic Task Prompt'].join('');
  const html = ['<section>', 'synthetic html-like text', '</section>'].join('');
  const marker = ['synthetic', '-', 'marker'].join('');
  const body = [
    'bounded synthetic text',
    tick.repeat(3),
    'nested three-tick content',
    tick.repeat(4),
    fakePrompt,
    html,
    tick.repeat(7),
    marker,
    '',
    'text after an empty line',
  ].join('\r\n');

  for (const section of untrustedSections) {
    const { fence, markdown } = completeSection(section.key, body);
    const renderedSection = sectionText(markdown, section.heading, section.nextHeading);
    const openingIndex = renderedSection.indexOf(`${fence}text`);
    const bodyIndex = renderedSection.indexOf(body);
    const markerIndex = renderedSection.indexOf(marker);
    const closingIndex = renderedSection.lastIndexOf(`\n${fence}`);

    assert.equal(fence.length, 8);
    assert.ok(openingIndex >= 0);
    assert.ok(bodyIndex > openingIndex);
    assert.ok(markerIndex > bodyIndex);
    assert.ok(closingIndex > markerIndex);
    assert.ok(renderedSection.indexOf(fakePrompt) < closingIndex);
    assert.ok(renderedSection.indexOf(html) < closingIndex);
  }
});

test('portable packet template supports empty untrusted sections without a fixed fence', () => {
  for (const section of untrustedSections) {
    const { fence, markdown } = completeSection(section.key, '');
    const renderedSection = sectionText(markdown, section.heading, section.nextHeading);

    assert.equal(fence.length, 3);
    assert.match(renderedSection, /```text\n\n```/);
  }
});
