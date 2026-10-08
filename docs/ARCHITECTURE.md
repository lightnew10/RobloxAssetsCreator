# Architecture RobloxAssetsCreator (générique low-poly)

## Nouveau chemin (jobs schemaVersion 2)
Entrée texte ou 0–4 photos → compréhension vision locale → inventaire LLM (catégorie parmi 8 + composants, identifiants et parents) → réparation structurelle → aperçu JSON optionnel → détail géométrique par primitives génériques → validation → interprétation Parts déterministe → Studio MCP (Model, pivot bas, sous-groupes) → audit → 3 captures → critique vision locale → corrections ciblées / rebuild → revue humaine et note → sauvegarde.

Les gabarits de catégories sont versionnés sous `prompts/categories/*.md`. L'IA retourne du JSON et jamais du Lua. Les primitives `box,wedge,cylinder,ball,cone,sweep,revolve,extrude,group` sont interprétées par `server/src/primitives.js` sans fonction spécifique à l'objet. Voir PRIMITIVES.md. Les approximations par Parts sont documentées ; pas de CSG exact.

## Compatibilité
Les jobs historiques conservent leur schéma et leurs moteurs. Pour un nouveau job Parts, l'interpréteur générique est essayé en priorité ; si la sortie échoue, un événement explicite de FULL TRACE signale le repli sur l'ancien constructeur Parts. Le mode Roblox natif ne se transforme pas silencieusement en Parts quand il est sélectionné seul. Le mode Auto privilégie Parts sur les catégories ordinaires et le natif pour certaines catégories organiques.

## Rôles IA et confidentialité
TEXT_MODEL : inventaire et paramètres. VISION_MODEL : photo. CRITIC_MODEL optionnel : contrôle visuel. Sérialisation des appels locaux, keep_alive:0, OLLAMA_NUM_CTX=8192. Aucune photo ne part vers un provider distant ; les appels image via visionStructuredChat y sont bloqués. Les appels texte distants restent optionnels, jamais sélectionnés automatiquement.

## Revue et apprentissage

### Revue structurée
La critique visuelle utilise le vocabulaire fermé de `server/src/review/defectRules.json`.
`defects.js` normalise les défauts et rejette les termes inconnus.
`paramRoles.json` associe les rôles de paramètres aux archétypes sans règle par objet dans la boucle.
Une action `param` ajuste un seul paramètre, borné par son schéma, puis reconstruit et revoit la variante.
Une action `instruct` transmet `Corrige : <issue> sur <component>` au prochain plan.
Une action `rebuild` redemande un plan si le budget le permet.
`keepCorrection` conserve une variante seulement si la note progresse sans nouveau défaut grave.
Une correction rejetée reste visible ; elle est exclue du meilleur candidat automatique.
`shouldStop` arrête à 8 sans défaut grave ou après trois notes stagnantes.
Les limites de patchs, rebuilds et tentatives de `qualityPolicy` restent actives.
Chaque passage écrit un événement `review.defects` sans changer les anciens formats de trace.
Le serveur peut arrêter un job au statut awaiting_decomposition_review si l'utilisateur active l'aperçu. La validation POST /api/jobs/:id/decomposition peut contenir un tableau de composants édité. La sauvegarde comprend une note humaine ; seuls les choix notés au moins 8 rejoignent library.jsonl. Les exemples natifs Roblox ne sont pas utilisés comme données d'entraînement. Les leçons historiques restent séparées.
FULL TRACE existant conserve les requêtes/réponses, plans, appels MCP, erreurs et captures ; de nouveaux événements `PRIMITIVE_GEOMETRY_BUILT`, `TARGETED_PRIMITIVE_PATCH`, `HUMAN_SELECTION` signalent les étapes de cette version.
Les 28 briefs d'évaluation ne sont pas une mesure visuelle tant que les captures et scores réels n'ont pas été produits.
