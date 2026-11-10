export const PICKER_MODES = ['rifle', 'trackmania'];
export const normalizeAngle = (angle) => ((angle % 360) + 360) % 360;

export function rotationTo(current, target, turns = 5) {
  if (![current, target].every(Number.isFinite) || !Number.isInteger(turns) || turns < 0) throw new Error('Invalid picker rotation.');
  return current + turns * 360 + normalizeAngle(target - current);
}

export function fitPickerArena(layout, width, height) {
  if (![width, height].every((value) => Number.isFinite(value) && value > 0)) throw new Error('Invalid picker space.');
  const scale = Math.min(1, width / layout.size, height / layout.size);
  return { scale, size: layout.size * scale };
}

// The full card includes its two-line name, target brackets and team badge.
// Solve for rectangle separation rather than spacing only the avatar centers.
function ringRadius(count, offset, cardWidth, cardHeight) {
  const points = Array.from({ length: count }, (_, i) => {
    const angle = (-90 + offset + i * 360 / count) * Math.PI / 180;
    return { x: Math.cos(angle), y: Math.sin(angle) };
  });
  let radius = 0;
  for (let i = 0; i < count; i++) for (let j = i + 1; j < count; j++) {
    radius = Math.max(radius, Math.min(cardWidth / Math.abs(points[i].x - points[j].x), cardHeight / Math.abs(points[i].y - points[j].y)));
  }
  return radius;
}

export function pickerLayout(participants, width = 640) {
  if (participants.length < 2 || participants.length > 64 || new Set(participants.map((row) => row.player_id)).size !== participants.length) throw new Error('A picker needs 2–64 distinct participants.');
  const dense = participants.length > 20;
  let size = Math.max(320, Math.min(1100, Number(width) || 640));
  let avatarWidth, avatarHeight, nameSize, nameWidth, radii, counts, offsets;
  const dimensions = (width) => {
    avatarWidth = width; avatarHeight = width * 1.12;
    nameSize = Math.max(14, Math.min(22, width * .16));
    nameWidth = Math.max(96, width + 8);
    return { cardWidth: nameWidth + 24, cardHeight: avatarHeight + 6 + nameSize * 2.6 + 24 };
  };
  if (dense) {
    const ringCount = participants.length <= 40 ? 2 : 3;
    const weights = Array.from({ length: ringCount }, (_, i) => 1 + i * .7);
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
    counts = weights.map((weight) => Math.floor(participants.length * weight / totalWeight));
    for (let remaining = participants.length - counts.reduce((sum, count) => sum + count, 0), i = counts.length - 1; remaining > 0; remaining--, i--) counts[i]++;
    offsets = counts.map((count, i) => i % 2 ? 180 / count : 0);
    const { cardWidth, cardHeight } = dimensions(76);
    const ringGap = Math.hypot(cardWidth, cardHeight) + 12;
    radii = counts.map((count, i) => Math.max(260, ringRadius(count, offsets[i], cardWidth, cardHeight)));
    for (let i = 1; i < radii.length; i++) radii[i] = Math.max(radii[i], radii[i - 1] + ringGap);
    size = Math.max(size, 2 * (radii.at(-1) + avatarHeight / 2 + 6 + nameSize * 2.6 + 20));
  } else {
    counts = [participants.length];
    // Put even quadrants between players instead of stacking a card at each pole.
    // This leaves room for larger portraits without pushing the ring outward.
    offsets = [participants.length % 4 === 0 ? 180 / participants.length : 0];
    let card, radius;
    // Use the center more tightly and spend the saved outer space on portraits.
    for (let width = Math.min(180, size * .20); ; width = Math.max(76, width - 2)) {
      card = dimensions(Math.max(76, width));
      radius = Math.max(size * .30, ringRadius(counts[0], offsets[0], card.cardWidth, card.cardHeight));
      if (2 * (radius + avatarHeight / 2 + 6 + nameSize * 2.6 + 20) <= size || width <= 76) break;
    }
    radii = [radius];
    size = Math.max(size, 2 * (radius + avatarHeight / 2 + 6 + nameSize * 2.6 + 20));
  }
  let index = 0;
  const slots = counts.flatMap((count, ring) => Array.from({ length: count }, (_, i) => {
    const player = participants[index++];
    const angle = -90 + i * 360 / count + offsets[ring];
    const radians = angle * Math.PI / 180, radius = radii[ring];
    return { id: player.player_id, angle, radius, x: size / 2 + Math.cos(radians) * radius, y: size / 2 + Math.sin(radians) * radius };
  }));
  // Measure the free center against actual portraits and labels. A circle around
  // a whole card wastes the diagonal gaps when players are placed farther inward.
  const rectangleDistance = (left, top, right, bottom) => Math.hypot(
    Math.max(0, left, -right), Math.max(0, top, -bottom),
  );
  const clearance = Math.min(...slots.map((slot) => {
    const x = slot.x - size / 2, y = slot.y - size / 2;
    return Math.min(
      rectangleDistance(x - avatarWidth / 2 - 8, y - avatarHeight / 2 - 14, x + avatarWidth / 2 + 14, y + avatarHeight / 2 + 8),
      rectangleDistance(x - nameWidth / 2 - 4, y + avatarHeight / 2 + 2, x + nameWidth / 2 + 4, y + avatarHeight / 2 + 6 + nameSize * 2.6 + 4),
    );
  }));
  const clearRadius = Math.max(30, clearance - 12);
  const rifleWidth = Math.max(1, Math.min(480, clearRadius / .57, (clearRadius - 12) / .48));
  const carWidth = Math.min(300, clearRadius / .62);
  for (const slot of slots) slot.driveDistance = Math.max(0, slot.radius - carWidth * .48 - avatarWidth * .2);
  return { size, dense, avatarWidth, avatarHeight, nameSize, nameWidth, clearRadius, rifleWidth, carWidth, slots, radii };
}
