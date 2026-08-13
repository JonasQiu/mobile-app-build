'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { parseRequirementSources } = require('../scripts/commands/workflow');

test('accepts direct requirement text without a link', () => {
  const result = parseRequirementSources({ text: '做一个非模板化电商页面', sources: [] });
  assert.equal(result.ok, true);
  assert.equal(result.source.type, 'text');
  assert.match(result.source.text, /非模板化/);
  assert.deepEqual(result.source.links, []);
});

test('combines a workspace text file with multiple source links', () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mobile-spec-source-'));
  fs.writeFileSync(path.join(projectRoot, 'requirement.md'), '需求正文', 'utf8');
  const result = parseRequirementSources({
    textFile: 'requirement.md',
    sources: ['https://example.com/brief', 'https://cooper.example.com/document/123'],
  }, { projectRoot });
  assert.equal(result.ok, true);
  assert.equal(result.source.type, 'composite');
  assert.equal(result.source.text, '需求正文');
  assert.equal(result.source.links.length, 2);
  assert.equal(result.source.links[0].type, 'web');
  assert.equal(result.source.links[1].type, 'cooper');
});

test('rejects text files outside the project workspace', () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mobile-spec-root-'));
  const result = parseRequirementSources({ textFile: '../secret.txt', sources: [] }, { projectRoot });
  assert.equal(result.ok, false);
  assert.match(result.message, /inside the project workspace/);
});

test('requires at least text or a source link', () => {
  const result = parseRequirementSources({ sources: [] });
  assert.equal(result.ok, false);
  assert.match(result.message, /requires requirement text/);
});
