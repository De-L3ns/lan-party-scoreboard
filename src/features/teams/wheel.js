import { escapeHtml as h } from '../../lib/html.js';

export function renderWheel(players) {
  const count = players.length;
  if (!count) return '<p class="empty-state">No players remaining.</p>';
  const colors = ['#354932', '#273b34', '#454831', '#2c3a43'];
  const point = (angle, radius) => [160 + Math.cos(angle * Math.PI / 180) * radius, 160 + Math.sin(angle * Math.PI / 180) * radius];
  const parts = players.map((player, index) => {
    const step = 360 / count;
    const start = -90 + index * step;
    const [x1, y1] = point(start, 145);
    const [x2, y2] = point(start + step, 145);
    const [x, y] = point(start + step / 2, 102);
    const shape = count === 1 ? '<circle cx="160" cy="160" r="145" fill="#354932"/>' : `<path d="M160 160 L${x1} ${y1} A145 145 0 ${step > 180 ? 1 : 0} 1 ${x2} ${y2} Z" fill="${colors[index % 4]}" stroke="#748363" stroke-width="1"/>`;
    return `${shape}${count <= 16 ? `<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="middle" transform="rotate(${start + step / 2 + 90} ${x} ${y})">${h(player.name.slice(0, 14))}</text>` : ''}`;
  }).join('');
  return `<div class="wheel-wrap" aria-hidden="true"><span class="wheel-pointer"></span><svg class="draw-wheel" viewBox="0 0 320 320">${parts}<circle cx="160" cy="160" r="30" fill="#182119" stroke="#849267"/></svg><span class="wheel-center">?</span></div>`;
}

export async function animateWheel(root, candidates, targetId, duration = 2800) {
  root.innerHTML = renderWheel(candidates);
  const wheel = root.querySelector('svg');
  if (!wheel) return { cancel() {} };
  const index = candidates.findIndex((player) => player.player_id === targetId);
  if (index < 0) throw new Error('The selected player is not in the remaining draft roster. Reload the game.');
  const degrees = 1800 + (360 - (index + 0.5) * (360 / candidates.length)) % 360;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || !wheel.animate) {
    wheel.style.transform = `rotate(${degrees}deg)`;
    return { finished: Promise.resolve(), cancel() {} };
  }
  return wheel.animate([{ transform: 'rotate(0deg)' }, { transform: `rotate(${degrees}deg)` }], { duration, easing: 'cubic-bezier(.12,.65,.08,1)', fill: 'forwards' });
}
