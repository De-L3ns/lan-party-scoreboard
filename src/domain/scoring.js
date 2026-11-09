export function toCents(value) {
  const text = String(value).trim();
  if (!/^-?\d+(\.\d{1,2})?$/.test(text)) throw new Error('Enter a number with at most two decimal places.');
  const cents = Math.round(Number(text) * 100);
  if (!Number.isSafeInteger(cents) || Math.abs(cents) > 999999999999) throw new Error('Points are outside the supported range.');
  return cents;
}

export function allocate(team, members) {
  if (!members.length) throw new Error('A team needs at least one player.');
  const mode = team.mode;
  if (mode === 'custom') return members.map((id) => ({ player_id: id, cents: toCents(team.custom?.[id] ?? '') }));
  const total = toCents(team.amount);
  if (mode === 'equal') return members.map((id) => ({ player_id: id, cents: total }));
  if (mode !== 'split') throw new Error('Choose a valid award rule.');
  const share = Math.trunc(total / members.length);
  return members.map((id, index) => ({ player_id: id, cents: share + (index === members.length - 1 ? total - share * members.length : 0) }));
}

export function previewAwards(teams, players, previous = []) {
  const old = new Map(previous.map((row) => [row.player_id, toCents(row.points)]));
  const totals = new Map(players.map((row) => [row.id, toCents(row.points)]));
  const seen = new Set();
  return teams.flatMap((team) => allocate(team, team.player_ids)).map(({ player_id, cents }) => {
    if (seen.has(player_id) || !totals.has(player_id)) throw new Error('Invalid or duplicate player in result.');
    seen.add(player_id);
    const before = totals.get(player_id);
    return { player_id, award: cents / 100, before: before / 100, after: (before + cents - (old.get(player_id) ?? 0)) / 100 };
  });
}

export function rankPlayers(players) {
  const sorted = [...players].sort((a, b) => Number(b.points) - Number(a.points) || a.name.localeCompare(b.name));
  return sorted.map((player, index) => ({ ...player, rank: index > 0 && Number(player.points) === Number(sorted[index - 1].points) ? sorted.findIndex((row) => Number(row.points) === Number(player.points)) + 1 : index + 1 }));
}
