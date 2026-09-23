const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const { verifyManifest, verifyDescriptor, descriptorPath } = require('../scripts/verify-android-auto');
const root = path.resolve(__dirname, '..');
const moduleManifest = readFileSync(path.join(root, 'modules/android-auto/android/src/main/AndroidManifest.xml'), 'utf8');
const descriptor = readFileSync(path.join(root, 'modules/android-auto/android/src/main/res/xml/automotive_app_desc.xml'), 'utf8');
const manifest = moduleManifest.replace('<manifest ', '<manifest package="com.podcastme.app.dev" ')
  .replace('<application>', '<application android:icon="@mipmap/ic_launcher">');

test('Android Auto source declares a discoverable media app', () => {
  verifyManifest(manifest, 'com.podcastme.app.dev');
  verifyDescriptor(descriptor);
});

test('rejects a missing Android Auto app descriptor', () => {
  assert.throws(() => verifyManifest(manifest.replace('com.google.android.gms.car.application', 'removed'), 'com.podcastme.app.dev'),
    /media descriptor is missing/);
});

test('rejects a media service that Android Auto cannot discover', () => {
  assert.throws(() => verifyManifest(manifest.replace('android.media.browse.MediaBrowserService', 'removed'), 'com.podcastme.app.dev'),
    /media browser service is missing/);
  assert.throws(() => verifyManifest(manifest.replace('android:exported="true"', 'android:exported="false"'), 'com.podcastme.app.dev'),
    /media browser service is missing/);
});

test('rejects an Android Auto descriptor without media support', () => {
  assert.throws(() => verifyDescriptor(descriptor.replace('name="media"', 'name="removed"')),
    /does not declare media/);
});

test('finds the descriptor after release resource names are shortened', () => {
  const resources = '    resource 0x7f150000 xml/automotive_app_desc\n' +
    '      () (file) res/oc.xml type=XML\n';
  assert.equal(descriptorPath(resources, '0x7f150000'), 'res/oc.xml');
  assert.equal(descriptorPath(resources, '0x7f150001'), null);
});
