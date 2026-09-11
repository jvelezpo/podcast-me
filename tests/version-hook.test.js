const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const root = path.resolve(__dirname, '..');
const gitDir = execFileSync('git', ['rev-parse', '--absolute-git-dir'], {
  cwd: root, encoding: 'utf8',
}).trim();
const hook = path.join(root, '.githooks/pre-commit');

function fixture(t) {
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'podcast-version-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  mkdirSync(path.join(cwd, 'objects'));
  mkdirSync(path.join(cwd, 'scripts'));
  writeFileSync(path.join(cwd, 'scripts/bump-version.js'),
    readFileSync(path.join(root, 'scripts/bump-version.js')));
  // Read the real HEAD, but isolate every index/object write and disable global hooks.
  const env = {
    ...process.env,
    GIT_DIR: gitDir,
    GIT_WORK_TREE: cwd,
    GIT_INDEX_FILE: path.join(cwd, 'index'),
    GIT_OBJECT_DIRECTORY: path.join(cwd, 'objects'),
    GIT_ALTERNATE_OBJECT_DIRECTORIES: path.join(gitDir, 'objects'),
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'core.hooksPath',
    GIT_CONFIG_VALUE_0: '/dev/null',
  };
  const git = (...args) => execFileSync('git', args, { cwd, env, encoding: 'utf8' }).trim();
  const read = (file) => JSON.parse(readFileSync(path.join(cwd, file), 'utf8'));
  const write = (file, value) => writeFileSync(path.join(cwd, file), `${JSON.stringify(value, null, 2)}\n`);
  git('read-tree', 'HEAD');
  for (const file of ['package.json', 'package-lock.json']) {
    writeFileSync(path.join(cwd, file), `${git('show', `HEAD:${file}`)}\n`);
  }
  const original = read('package.json').version;
  const run = () => spawnSync('sh', [hook], { cwd, env, encoding: 'utf8' });
  const stageChange = () => {
    writeFileSync(path.join(cwd, 'version-test.txt'), 'change\n');
    git('add', 'version-test.txt');
  };
  const assertVersion = (expected) => {
    assert.equal(read('package.json').version, expected);
    assert.equal(read('package-lock.json').version, expected);
    assert.equal(read('package-lock.json').packages[''].version, expected);
    assert.equal(JSON.parse(git('show', ':package.json')).version, expected);
    assert.equal(JSON.parse(git('show', ':package-lock.json')).version, expected);
  };
  return { git, read, write, original, run, stageChange, assertVersion };
}

test('bumps a patch, synchronizes the lockfile, and does not bump again on retry', (t) => {
  const f = fixture(t);
  f.stageChange();
  const [major, minor, patch] = f.original.split('.').map(Number);
  const expected = `${major}.${minor}.${patch + 1}`;
  const first = f.run();
  assert.equal(first.status, 0, first.stderr);
  f.assertVersion(expected);
  const retry = f.run();
  assert.equal(retry.status, 0, retry.stderr);
  f.assertVersion(expected);
});

for (const release of ['minor', 'major']) {
  test(`honors an explicit ${release} bump and synchronizes the lockfile`, (t) => {
    const f = fixture(t);
    const pkg = f.read('package.json');
    const [major, minor] = f.original.split('.').map(Number);
    pkg.version = release === 'major' ? `${major + 1}.0.0` : `${major}.${minor + 1}.0`;
    f.write('package.json', pkg);
    f.git('add', 'package.json');
    const result = f.run();
    assert.equal(result.status, 0, result.stderr);
    f.assertVersion(pkg.version);
  });
}

for (const file of ['package.json', 'package-lock.json']) {
  test(`refuses unstaged edits in ${file} without changing staged data`, (t) => {
    const f = fixture(t);
    f.stageChange();
    const before = f.git('diff', '--cached');
    const value = f.read(file);
    value.description = 'Unstaged work';
    f.write(file, value);
    const result = f.run();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Stage or stash/);
    assert.equal(f.git('diff', '--cached'), before);
    assert.deepEqual(f.read(file), value);
  });
}

test('does not create a version bump for an empty index', (t) => {
  const f = fixture(t);
  assert.equal(f.run().status, 0);
  f.assertVersion(f.original);
  assert.equal(f.git('diff', '--cached'), '');
});

test('rejects an invalid staged version without rewriting the lockfile', (t) => {
  const f = fixture(t);
  const pkg = f.read('package.json');
  const lock = f.read('package-lock.json');
  pkg.version = 'invalid';
  f.write('package.json', pkg);
  f.git('add', 'package.json');
  assert.notEqual(f.run().status, 0);
  assert.deepEqual(f.read('package-lock.json'), lock);
});
