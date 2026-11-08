import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readPublicConfig } from '../../src/config/env.js';

const configured = {
  VITE_SUPABASE_URL: 'https://example.supabase.co',
  VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_example',
};

test('an unconfigured checkout can start without inventing a backend', () => {
  const config = readPublicConfig();
  assert.equal(config.isConfigured, false);
  assert.deepEqual(config.issues, []);
});

test('a URL without a key does not initialize the client', () => {
  const config = readPublicConfig({ VITE_SUPABASE_URL: configured.VITE_SUPABASE_URL });
  assert.equal(config.isConfigured, false);
  assert.ok(config.issues.length > 0);
});

test('valid public settings are normalized for the client', () => {
  const config = readPublicConfig({
    ...configured,
    VITE_SUPABASE_URL: ` ${configured.VITE_SUPABASE_URL} `,
    VITE_ADMIN_EMAIL: ' organizer@example.com ',
  });
  assert.equal(config.isConfigured, true);
  assert.equal(config.supabaseUrl, 'https://example.supabase.co');
  assert.equal(config.adminEmail, 'organizer@example.com');
});

test('a secret or legacy key is rejected without echoing its value', () => {
  for (const key of ['sb_secret_do-not-expose', 'eyJlegacy-jwt', 'not-a-key']) {
    const config = readPublicConfig({ ...configured, VITE_SUPABASE_PUBLISHABLE_KEY: key });
    assert.equal(config.isConfigured, false);
    assert.ok(config.issues.length > 0);
    assert.ok(config.issues.every((issue) => !issue.includes(key)));
  }
});

test('invalid or unsafe project URLs are rejected', () => {
  for (const url of ['invalid', 'http://example.supabase.co', 'https://user:password@example.com', 'https://example.com/?key=value', 'https://example.com/path', 'https://example.com/#hash']) {
    assert.equal(readPublicConfig({ ...configured, VITE_SUPABASE_URL: url }).isConfigured, false, url);
  }
});

test('a local Supabase origin is supported', () => {
  assert.equal(readPublicConfig({ ...configured, VITE_SUPABASE_URL: 'http://127.0.0.1:54321' }).isConfigured, true);
});
