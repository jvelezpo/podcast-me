const { spawnSync } = require('node:child_process');
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');

const result = spawnSync('git', ['rev-parse', '--git-dir'], { encoding: 'utf8' });

// Build archives do not contain Git metadata.
if (result.status !== 0) process.exit(0);

const hookPath = path.join(result.stdout.trim(), 'hooks', 'pre-commit');
const hook = '#!/bin/sh\n# podcast-me version hook\nexec sh .githooks/pre-commit "$@"\n';

if (existsSync(hookPath) && readFileSync(hookPath, 'utf8') !== hook) {
  throw new Error(`An existing ${hookPath} must be chained to .githooks/pre-commit manually.`);
}

mkdirSync(path.dirname(hookPath), { recursive: true });
writeFileSync(hookPath, hook, { mode: 0o755 });
console.log('Installed Podcast Me pre-commit version hook.');
