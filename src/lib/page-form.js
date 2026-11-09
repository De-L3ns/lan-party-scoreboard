import { escapeHtml as h } from './html.js';

// The same form contract as the organizer dialogs, presented as a full page.
export function createPageForm(root, { canSubmit = () => true } = {}) {
  let form;
  let busy = false;
  let disposed = false;
  const update = () => {
    if (form) form.querySelector('[type=submit]').disabled = busy || !canSubmit();
  };
  return {
    open({ title, content, submit = 'Save', onSubmit, onInput }) {
      root.innerHTML = `${title ? `<h2 class="sr-only">${h(title)}</h2>` : ''}<form><div class="dialog-content">${content}</div><p class="form-error page-error" role="alert"></p><div class="flow-actions"><button class="button primary" type="submit">${h(submit)}</button></div></form>`;
      form = root.querySelector('form');
      form.addEventListener('input', () => {
        form.querySelector('.page-error').textContent = '';
        onInput?.(form);
        update();
      });
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (disposed || busy || !canSubmit() || !form.reportValidity()) return;
        busy = true; form.inert = true; update();
        try { await onSubmit(form); }
        catch (error) { if (!disposed) form.querySelector('.page-error').textContent = error.message; }
        finally { busy = false; form.inert = false; update(); }
      });
      update();
      return form;
    },
    update,
    get busy() { return busy; },
    dispose() { disposed = true; },
  };
}
