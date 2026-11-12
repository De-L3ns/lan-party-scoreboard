import { escapeHtml as h, formatPoints, imageMarkup, installImageFallbacks } from '../../lib/html.js';
import { knockoutPlaces } from '../../domain/knockout.js';
import { toCents } from '../../domain/scoring.js';
import { createResultSaver } from '../games/result-saver.js';
import { mvpSelectionMarkup } from '../games/mvp.js';

const placeLabel = (place) => `${place}${place % 100 >= 11 && place % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' })[place % 10] || 'th'} place`;

function awardGroups(game) {
  const places = knockoutPlaces(game);
  const saved = new Map((game.awards || []).map((award) => [award.player_id, toCents(award.points)]));
  const groups = new Map();
  for (const team of game.teams) {
    const id = team.members[0].player_id, place = places.get(id);
    if (!place) throw new Error('Finish the tournament before awarding points.');
    const player = game.participants?.find((row) => row.player_id === id) || { player_id: id, name: team.name, image_path: null };
    if (!groups.has(place)) groups.set(place, { place, entries: [] });
    groups.get(place).entries.push({ team, player, cents: saved.get(id) ?? toCents(team.award?.amount ?? '0') });
  }
  return [...groups.values()].sort((a, b) => a.place - b.place).map((group) => {
    group.entries.sort((a, b) => a.player.name.localeCompare(b.player.name) || a.team.id.localeCompare(b.team.id));
    const amounts = new Set(group.entries.map((entry) => entry.cents));
    return { ...group, mixed: amounts.size > 1, amount: amounts.size === 1 ? String(group.entries[0].cents / 100) : '' };
  });
}

export function openKnockoutAwards(presenter, { game, board, api, onSaved }) {
  game = structuredClone(game);
  const groups = awardGroups(game);
  const saver = createResultSaver({ board, game, api, onSaved });
  const inputName = (place) => `rank-${place}-points`;
  const read = (form) => groups.flatMap((group) => {
    const amount = form.elements[inputName(group.place)].value.trim();
    try { toCents(amount); } catch (error) { throw new Error(`${placeLabel(group.place)}: ${error.message}`); }
    return group.entries.map(({ team, player }) => ({ id: team.id, result: String(group.place), mode: 'equal', amount, player_ids: [player.player_id] }));
  });
  const correcting = game.score_revision > 0;
  const form = presenter.open({ title: `${correcting ? 'Correct' : 'Record'} result: ${game.name}`, submit: 'Save results',
    content: `<p class="form-help">Points apply to each player listed at that rank.</p>${groups.map((group) => `<fieldset class="result-team ko-rank-award" data-rank="${group.place}"><legend>${placeLabel(group.place)} <span class="ko-rank-count">· ${group.entries.length} ${group.entries.length === 1 ? 'player' : 'players'}</span></legend><div class="ko-rank-award-layout"><ul class="ko-rank-players">${group.entries.map(({ player, cents }) => `<li>${imageMarkup(api.imageUrl(player.image_path), player.name, 'small-portrait')}<div><strong>${h(player.name)}</strong>${group.mixed ? `<small>Previous award: ${formatPoints(cents / 100)}</small>` : ''}</div></li>`).join('')}</ul><div><label>Points per player<input name="${inputName(group.place)}" value="${group.amount}" inputmode="decimal" required ${group.mixed ? 'placeholder="Enter points for this rank"' : ''}></label>${group.mixed ? '<p class="form-help">Previous awards differ. Enter one value to apply to everyone at this rank.</p>' : ''}</div></div></fieldset>`).join('')}${mvpSelectionMarkup(game)}<label>${correcting ? 'Reason for correction' : 'Note (optional)'}<input name="reason" maxlength="500" ${correcting ? 'required' : ''}></label>`,
    onSubmit: async (form) => saver.save(read(form), form.elements.reason.value, form.elements.mvp_player_id?.value),
  });
  installImageFallbacks(form);
  return form;
}
