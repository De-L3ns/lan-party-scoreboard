export const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
export const formatPoints = (value) => new Intl.NumberFormat('en', { maximumFractionDigits: 2 }).format(Number(value));

const renderedHtml = new WeakMap();

// Keep existing images, focus and browser state during unchanged live refreshes.
// Child identities invalidate the cache when another view clears the container.
export function setHtml(root, html) {
  const previous = renderedHtml.get(root);
  if (previous?.html === html && previous.first === root.firstChild && previous.last === root.lastChild) return false;
  root.innerHTML = html;
  renderedHtml.set(root, { html, first: root.firstChild, last: root.lastChild });
  return true;
}

export function imageMarkup(url, name, className = 'portrait') {
  return `<span class="${className}"><span class="portrait-fallback" aria-hidden="true">${escapeHtml(name.slice(0, 2).toUpperCase())}</span>${url ? `<img src="${escapeHtml(url)}" alt="" loading="lazy">` : ''}</span>`;
}

export function installImageFallbacks(root) {
  root.querySelectorAll('img').forEach((image) => image.addEventListener('error', () => image.remove(), { once: true }));
}
