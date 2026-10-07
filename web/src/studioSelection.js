// Synchronise la sélection avec les instances réellement exposées par le serveur MCP.
// Ne tente jamais d'autoriser un studioId qui n'est plus présent dans la liste.
export function resolveStudioSelection(studios = [], selectedId = '', authorizedId = '') {
  const valid = studios.filter((studio) => typeof studio?.id === 'string' && studio.id.length > 0);
  if (valid.some((studio) => studio.id === selectedId)) return selectedId;
  if (valid.some((studio) => studio.id === authorizedId)) return authorizedId;
  return valid[0]?.id || '';
}
