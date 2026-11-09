export function createDialog() {
  const dialog = document.createElement('dialog');
  dialog.className = 'modal';
  dialog.setAttribute('aria-labelledby', 'dialog-title');
  document.body.append(dialog);
  let busy = false;
  dialog.addEventListener('cancel', (event) => { if (busy) event.preventDefault(); });
  return {
    open({ title, content, submit = 'Save', onSubmit, onInput }) {
      if (dialog.open) dialog.close();
      busy = false;
      dialog.innerHTML = `<form><header><h2 id="dialog-title"></h2><button type="button" class="icon-button" data-close aria-label="Close">×</button></header><div class="dialog-content">${content}</div><p class="form-error" role="alert"></p><footer><button type="button" class="button" data-close>Cancel</button><button class="button primary" type="submit"></button></footer></form>`;
      dialog.querySelector('h2').textContent = title;
      const form = dialog.querySelector('form');
      const submitButton = form.querySelector('[type=submit]');
      submitButton.textContent = submit;
      dialog.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => { if (!busy) dialog.close(); }));
      form.addEventListener('input', () => {
        form.querySelector('.form-error').textContent = '';
        onInput?.(form);
      });
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (busy || !form.reportValidity()) return;
        busy = true; submitButton.disabled = true;
        try {
          const close = await onSubmit(form);
          if (close !== false) dialog.close();
        } catch (error) {
          form.querySelector('.form-error').textContent = error.message;
        } finally {
          busy = false; submitButton.disabled = false;
        }
      });
      dialog.showModal();
      return form;
    },
    close() { dialog.close(); },
    clear() { busy = false; dialog.close(); dialog.replaceChildren(); },
    get isOpen() { return dialog.open; },
  };
}
