const { execFileSync } = require('node:child_process');
const { existsSync, readFileSync, readdirSync, statSync } = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const serviceName = 'expo.modules.androidauto.PodcastMediaLibraryService';
const browseAction = 'android.media.browse.MediaBrowserService';
const descriptorName = 'com.google.android.gms.car.application';

function requireMatch(value, pattern, message) {
  if (!pattern.test(value)) throw new Error(message);
}

function xmlTag(xml, name, attribute, value) {
  return [...xml.matchAll(new RegExp(`<${name}\\b[^>]*>`, 'g'))]
    .map(([tag]) => tag)
    .find((tag) => new RegExp(`\\b${attribute}="${value}"`).test(tag));
}

function verifyManifest(xml, expectedPackage) {
  requireMatch(xml, new RegExp(`<manifest\\b[^>]*\\bpackage="${expectedPackage.replaceAll('.', '\\.')}"`),
    `Android package must be ${expectedPackage}`);
  const application = xmlTag(xml, 'application', 'android:icon', '@mipmap/ic_launcher');
  if (!application) throw new Error('Android application launcher icon is missing');
  const descriptor = xmlTag(xml, 'meta-data', 'android:name', descriptorName);
  if (!descriptor || !/\bandroid:resource="@xml\/automotive_app_desc"/.test(descriptor)) {
    throw new Error('Android Auto media descriptor is missing from the app');
  }
  const service = xml.match(new RegExp(`<service\\b(?=[^>]*android:name="${serviceName}")([^>]*)>([\\s\\S]*?)<\\/service>`));
  if (!service || !/\bandroid:exported="true"/.test(service[1]) ||
      !xmlTag(service[2], 'action', 'android:name', browseAction)) {
    throw new Error('Exported Android Auto media browser service is missing from the app');
  }
}

function verifyDescriptor(xml) {
  requireMatch(xml, /<automotiveApp\b/, 'Android Auto descriptor root is missing');
  if (!xmlTag(xml, 'uses', 'name', 'media')) {
    throw new Error('Android Auto descriptor does not declare media');
  }
}

function aapt() {
  const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  if (!sdk) throw new Error('ANDROID_HOME or ANDROID_SDK_ROOT is required to inspect an APK');
  const buildTools = path.join(sdk, 'build-tools');
  const versions = readdirSync(buildTools).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  const executable = versions.map((version) => path.join(buildTools, version, 'aapt'))
    .find(existsSync);
  if (!executable) throw new Error('Android SDK aapt is required to inspect an APK');
  return executable;
}

function aaptBlock(tree, tag, attributeValue) {
  const lines = tree.split('\n');
  for (let index = 0; index < lines.length; index++) {
    const start = lines[index];
    if (!start.trim().startsWith(`E: ${tag} `)) continue;
    const indent = start.length - start.trimStart().length;
    let end = index + 1;
    while (end < lines.length && (lines[end].length - lines[end].trimStart().length) > indent) end++;
    const block = lines.slice(index, end).join('\n');
    if (block.includes(`="${attributeValue}"`)) return block;
  }
  return null;
}

function descriptorPath(resources, resourceId) {
  const lines = resources.split('\n');
  const index = lines.findIndex((line) =>
    line.includes(`resource ${resourceId} xml/automotive_app_desc`));
  return index < 0 ? null : lines[index + 1]?.match(/\(file\) (\S+) type=XML/)?.[1] || null;
}

function verifyApk(apk, expectedPackage) {
  const tool = aapt();
  const run = (...args) => execFileSync(tool, args, { encoding: 'utf8' });
  const badging = run('dump', 'badging', apk);
  requireMatch(badging, new RegExp(`^package: name='${expectedPackage.replaceAll('.', '\\.')}'`, 'm'),
    `APK package must be ${expectedPackage}`);
  requireMatch(badging, /^application-label:/m, 'APK application label is missing');
  requireMatch(badging, /^application-icon-/m, 'APK launcher icon is missing');
  const manifest = run('dump', 'xmltree', apk, 'AndroidManifest.xml');
  const descriptor = aaptBlock(manifest, 'meta-data', descriptorName);
  const descriptorId = descriptor?.match(/android:resource\([^)]*\)=@(0x[0-9a-f]+)/)?.[1];
  if (!descriptorId) {
    throw new Error('APK is missing the Android Auto media descriptor');
  }
  const service = aaptBlock(manifest, 'service', serviceName);
  if (!service || !service.includes('android:exported') ||
      !service.includes('0xffffffff') || !service.includes(`="${browseAction}"`)) {
    throw new Error('APK is missing the exported Android Auto media browser service');
  }
  // Release resource optimization can rename res/xml/automotive_app_desc.xml.
  // Follow the resource ID from the packaged manifest to the packaged XML file.
  const resources = execFileSync(path.join(path.dirname(tool), 'aapt2'),
    ['dump', 'resources', apk], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  const mediaPath = descriptorPath(resources, descriptorId);
  if (!mediaPath) throw new Error('APK is missing the Android Auto descriptor resource');
  const media = run('dump', 'xmltree', apk, mediaPath);
  if (!aaptBlock(media, 'uses', 'media')) {
    throw new Error('APK Android Auto descriptor does not declare media');
  }
}

function newestFile(directory, extension) {
  if (!existsSync(directory)) return null;
  const files = readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? [newestFile(file, extension)].filter(Boolean)
      : entry.name.endsWith(extension) ? [file] : [];
  });
  return files.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0] || null;
}

function main() {
  if (process.env.EAS_BUILD_PLATFORM && process.env.EAS_BUILD_PLATFORM !== 'android') return;
  const expectedPackage = process.env.APP_VARIANT === 'development'
    ? 'com.podcastme.app.dev' : 'com.podcastme.app';
  const explicitApk = process.argv[2];
  if (explicitApk) {
    verifyApk(path.resolve(explicitApk), expectedPackage);
    console.log(`Android Auto discovery verified in ${explicitApk}`);
    return;
  }
  const output = path.join(root, 'android/app/build/outputs');
  const apk = newestFile(path.join(output, 'apk'), '.apk');
  const bundle = newestFile(path.join(output, 'bundle'), '.aab');
  if (!apk && !bundle) throw new Error('No Android build artifact found to verify');
  if (apk && (!bundle || statSync(apk).mtimeMs > statSync(bundle).mtimeMs)) {
    verifyApk(apk, expectedPackage);
    console.log(`Android Auto discovery verified in ${apk}`);
    return;
  }
  const variant = process.env.APP_VARIANT === 'development' ? 'debug' : 'release';
  const manifest = newestFile(path.join(root, `android/app/build/intermediates/packaged_manifests/${variant}`), 'AndroidManifest.xml');
  if (!manifest) throw new Error(`No packaged ${variant} Android manifest found to verify`);
  verifyManifest(readFileSync(manifest, 'utf8'), expectedPackage);
  verifyDescriptor(readFileSync(path.join(root, 'modules/android-auto/android/src/main/res/xml/automotive_app_desc.xml'), 'utf8'));
  console.log(`Android Auto discovery verified in ${manifest}`);
}

if (require.main === module) {
  try { main(); } catch (error) { console.error(`Android Auto build check failed: ${error.message}`); process.exitCode = 1; }
}

module.exports = { verifyManifest, verifyDescriptor, verifyApk, descriptorPath };
