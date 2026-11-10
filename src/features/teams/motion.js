export const abortError = () => new DOMException('Animation interrupted.', 'AbortError');
export function checkSignal(signal) { if (signal?.aborted) throw abortError(); }

export function wait(ms, signal) {
  checkSignal(signal);
  return new Promise((resolve, reject) => {
    const cancel = () => { clearTimeout(timer); reject(abortError()); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', cancel); resolve(); }, ms);
    signal?.addEventListener('abort', cancel, { once: true });
  });
}

export async function animate(element, frames, options, signal) {
  checkSignal(signal);
  if (!element.animate) { Object.assign(element.style, frames.at(-1)); return; }
  const animation = element.animate(frames, { ...options, fill: 'forwards' });
  const cancel = () => animation.cancel();
  signal?.addEventListener('abort', cancel, { once: true });
  try { await animation.finished; checkSignal(signal); Object.assign(element.style, frames.at(-1)); }
  finally { signal?.removeEventListener('abort', cancel); animation.cancel(); }
}
