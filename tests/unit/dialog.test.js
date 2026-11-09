import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDialog } from '../../src/lib/dialog.js';

test('reading dialog state must not replace the callable open API used by admin forms', () => {
  const originalDocument = globalThis.document;
  const element = { open: false, setAttribute() {}, addEventListener() {} };
  globalThis.document = {
    createElement: () => element,
    body: { append() {} },
  };
  try {
    const dialog = createDialog();
    assert.equal(typeof dialog.open, 'function');
    assert.equal(dialog.isOpen, false);
    element.open = true;
    assert.equal(dialog.isOpen, true);
    assert.equal(typeof dialog.open, 'function');
  } finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  }
});
