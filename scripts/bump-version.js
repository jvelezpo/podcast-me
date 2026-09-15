const { execFileSync, spawnSync } = require('node:child_process');
const { readFileSync } = require('node:fs');

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const versionFiles = ['package.json', 'package-lock.json'];

try {
  // Do not turn an empty commit attempt into a version-only commit.
  if (!git('diff', '--cached', '--name-only')) {
    console.log('Version hook: no new version cut (nothing staged).');
    process.exit(0);
  }

  if (git('diff', '--name-only', '--', ...versionFiles)) {
    throw new Error('Stage or stash all changes to package.json and package-lock.json before committing.');
  }

  const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
  const previous = spawnSync('git', ['show', 'HEAD:package.json'], { encoding: 'utf8' });
  const previousVersion = previous.status === 0 ? JSON.parse(previous.stdout).version : null;
  // A staged version bump also covers retries after another hook rejects a commit.
  const hasStagedVersion = version !== previousVersion;
  const release = hasStagedVersion ? version : 'patch';

  execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', [
    'version', release, '--no-git-tag-version', '--ignore-scripts', '--allow-same-version',
  ], { stdio: 'inherit' });
  git('add', '--', ...versionFiles);
  console.log(
    hasStagedVersion
      ? `Version hook: no new version cut (using staged version ${version}).`
      : `Version hook: cut new version ${JSON.parse(readFileSync('package.json', 'utf8')).version}.`
  );
} catch (error) {
  console.error(`Version hook: ${error.message}`);
  process.exit(1);
}
