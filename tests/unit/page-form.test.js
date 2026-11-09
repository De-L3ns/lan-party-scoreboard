import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPageForm } from '../../src/lib/page-form.js';

function fixture(canSubmit = () => true) {
  const listeners = {};
  const button = {};
  const error = { textContent: '' };
  const form = { value: 'unsaved input', reportValidity: () => true, addEventListener: (name, handler) => { listeners[name] = handler; }, querySelector: (selector) => selector === '[type=submit]' ? button : error };
  const root = { querySelector: () => form };
  const page = createPageForm(root, { canSubmit });
  const submit = () => listeners.submit({ preventDefault() {} });
  return { page, form, button, error, submit, listeners };
}

test('page forms prevent duplicate submissions and keep input available after a failed save', async () => {
  const f = fixture();
  let reject;
  let calls = 0;
  f.page.open({ content: '', onSubmit: () => { calls += 1; return new Promise((resolve, fail) => { reject = fail; }); } });
  const pending = f.submit();
  assert.equal(f.page.busy, true);
  assert.equal(f.form.inert, true);
  assert.equal(f.button.disabled, true);
  await f.submit();
  assert.equal(calls, 1);
  reject(new Error('Connection lost'));
  await pending;
  assert.equal(f.error.textContent, 'Connection lost');
  assert.equal(f.form.value, 'unsaved input');
  assert.equal(f.page.busy, false);
  assert.equal(f.form.inert, false);
  assert.equal(f.button.disabled, false);
});

test('offline, unauthorized, invalid, or disposed forms cannot save', async () => {
  let allowed = false;
  let calls = 0;
  const f = fixture(() => allowed);
  f.page.open({ content: '', onSubmit: () => { calls += 1; } });
  await f.submit();
  allowed = true;
  f.form.reportValidity = () => false;
  await f.submit();
  f.form.reportValidity = () => true;
  f.page.dispose();
  await f.submit();
  assert.equal(calls, 0);
});

test('editing a reviewed form invalidates confirmation before another save', async () => {
  const f = fixture();
  let confirmed = false;
  let saves = 0;
  f.page.open({ content: '', onInput: () => { confirmed = false; }, onSubmit: () => { if (!confirmed) { confirmed = true; return false; } saves += 1; } });
  await f.submit();
  assert.equal(saves, 0);
  f.listeners.input();
  await f.submit();
  assert.equal(saves, 0);
  await f.submit();
  assert.equal(saves, 1);
});
