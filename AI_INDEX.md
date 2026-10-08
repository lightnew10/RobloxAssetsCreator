# AI_INDEX — RobloxAssetsCreator

Dernière revue documentaire : 2026-10-08. Le dépôt et ses tests sont la source de vérité ; cet index ne garantit pas que les fonctionnalités ont été validées dans Roblox Studio.

## Objectif
Créer et améliorer des assets 3D Roblox indépendamment de MyRGame ; trois variantes par défaut, contrôle qualité et choix humain.

## Lire en fonction de la tâche
- Règles agent : [AGENTS.md](AGENTS.md)
- Architecture constatée : [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Tests manuels : [docs/TESTING.md](docs/TESTING.md)
- Corrections par patch : [docs/CORRECTIONS.md](docs/CORRECTIONS.md)
- Refonte progressive PROPOSÉE : [docs/ASSET_PIPELINE_V2.md](docs/ASSET_PIPELINE_V2.md)
- ComfyUI / textures PROPOSÉS : [docs/COMFYUI_INTEGRATION.md](docs/COMFYUI_INTEGRATION.md)
- Catalogue des presets NON branchés : [prompts/README.md](prompts/README.md)

## Code source — chercher seulement ce qui est utile
- server/src/pipeline.js : étapes, variantes, critique et récupération.
- server/src/prompts.js : prompts effectivement utilisés aujourd'hui.
- server/src/spatialPlan.js : schémas et réparation des relations parent/enfant.
- server/src/geometry.js : géométrie Parts et fallback.
- server/src/assetStudio.js : construction via Roblox Studio MCP.
- server/src/providers.js : appels à Ollama et fournisseurs externes.
- server/src/capture.js : captures pour la critique.
- server/src/qualityPolicy.js : acceptation et relances.
- server/src/review/ : vocabulaire fermé, rôles paramétriques et décisions de correction.
- server/src/change/ : empreintes, patchs bornés, historique append-only et exemples de corrections validées.
- Revue web : tableau des variantes, notes humaines révisables et historique ; lots de trois en série avec arrêt automatique après un nombre choisi de lots, ou jusqu'à arrêt humain.
- server/src/trace.js : traces détaillées.
- server/src/telegram.js : notifications optionnelles au démarrage, sur erreur et toutes les heures ; configuration dans `server/.env` décrite dans README.md.
- server/test/ : tests automatisés existants.

## Limites repérées dans la version examinée
- Plan spatial plafonné à 24 composants normalisés.
- Constructeur Parts plafonné à 180 pièces, utilisant box / cylinder / ball / wedge.
- Les presets du dossier prompts/ ne sont pas encore connectés au pipeline.
- Pas d'intégration ComfyUI vérifiée ; aucune validation runtime Roblox effectuée pendant la rédaction des documents.

## Prochain objectif
Établir une référence de qualité mesurable avec les tests Studio, introduire une représentation géométrique mieux adaptée aux objets organiques, puis expérimenter une voie hybride Mesh/Parts et un flux textures optionnel, sans régression sur le mode actuel.
