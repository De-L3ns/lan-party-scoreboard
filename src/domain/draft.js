export function destinationForPick(index, teamCount) {
  if (!Number.isInteger(index) || index < 0 || !Number.isInteger(teamCount) || teamCount < 2 || teamCount > 8) throw new Error('Invalid pick or team count.');
  return index % teamCount;
}

export function validateParticipants(playerIds) {
  if (playerIds.length < 2 || playerIds.length > 64 || new Set(playerIds).size !== playerIds.length) throw new Error('Select 2–64 different players.');
}

export function validateDraft(playerIds, teamCount) {
  validateParticipants(playerIds);
  destinationForPick(0, teamCount);
  if (teamCount > playerIds.length) throw new Error('Each team needs at least one player.');
}
