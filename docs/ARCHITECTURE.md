# Architecture RobloxAssetsCreator (générique low-poly)

## Nouveau chemin (jobs schemaVersion 2)
Entrée texte ou 0–4 photos → compréhension vision locale → inventaire LLM (catégorie parmi 8 + composants, identifiants et parents) → réparation structurelle → aperçu JSON optionnel → détail géométrique par primitives génériques → validation → interprétation Parts déterministe → Studio MCP (Model, pivot bas, sous-groupes) → audit → 3 captures → critique vision locale → corrections ciblées / rebuild → revue humaine et note → sauvegarde.

Les gabarits de catégories sont versionnés sous `prompts/categories/*.md`. L'IA retourne du JSON et jamais du Lua. Les primitives `box,wedge,cylinder,ball,cone,sweep,revolve,extrude,group` sont interprétées par `server/src/primitives.js` sans fonction spécifique à l'objet. Voir PRIMITIVES.md. Les approximations par Parts sont documentées ; pas de CSG exact.

## Compatibilité

Les nouvelles variantes sont placées après les modèles RAC déjà présents dans tous les dossiers `Workspace/RobloxAssetsCreator_*`, avec un écart calculé pour que les captures centrées sur la nouvelle variante n'incluent pas les anciennes. Les modèles existants ne sont pas déplacés.

Le mode de génération en série crée des lots successifs de trois variantes dans un même job. `batchTarget` est un entier positif facultatif : si présent, le job passe en `review_ready` après ce nombre de lots terminés ; sinon, il continue jusqu'à l'arrêt humain. Chaque lot terminé reste dans le tableau de revue pendant que le suivant démarre. Une correction explicitement demandée est traitée avant la clôture du lot final ; un rebuild demandé peut créer un lot supplémentaire. Les notes humaines répétées sont conservées dans `humanRatingHistory` par variante ; elles ne valident pas la bibliothèque sans choix et sauvegarde explicites. La note d'une variante déjà sauvegardée est figée pour préserver la cohérence de la bibliothèque. Les liens `correctionOf` et `rebuildOf`, la version du plan et les événements du job décrivent la filiation des variantes. Les jobs anciens sans ce mode ou sans `batchTarget` gardent leur comportement existant.
Les jobs historiques conservent leur schéma et leurs moteurs. Pour un nouveau job Parts, l'interpréteur générique est essayé en priorité ; si la sortie échoue, un événement explicite de FULL TRACE signale le repli sur l'ancien constructeur Parts. Le mode Roblox natif ne se transforme pas silencieusement en Parts quand il est sélectionné seul. Le mode Auto privilégie Parts sur les catégories ordinaires et le natif pour certaines catégories organiques.

## Rôles IA et confidentialité
TEXT_MODEL : inventaire et paramètres. VISION_MODEL : photo. CRITIC_MODEL optionnel : contrôle visuel. Sérialisation des appels locaux, keep_alive:0, OLLAMA_NUM_CTX=8192. Aucune photo ne part vers un provider distant ; les appels image via visionStructuredChat y sont bloqués. Les appels texte distants restent optionnels, jamais sélectionnés automatiquement.

## Revue et apprentissage

### Corrections par patch
Les corrections Parts repartent de la définition sauvegardée et appliquent des opérations validées par schéma, ciblant un paramètre ou une primitive à identifiant stable. La variante source reste intacte ; les anciennes définitions sont complétées lors de leur première correction. Empreintes de définition et de géométrie, captures avant/après et revue visuelle ciblée déterminent `resolved`, `unresolved` ou `no_effect`. Les meshes natifs reçoivent une nouvelle consigne et sont comparés par captures. Les tentatives, validations et demandes non supportées sont conservées dans des JSONL locaux ; seules les corrections résolues et validées par l'utilisateur servent d'exemples. Voir [CORRECTIONS.md](CORRECTIONS.md).

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
Les notifications Telegram sont optionnelles et configurées par `TELEGRAM_BOT_TOKEN` côté serveur. Après un `/start` privé, `server/src/telegram.js` détecte un unique chat via `getUpdates` et conserve son identifiant dans `data/runtime/telegram-chat.json`, associé à l'empreinte du token. `TELEGRAM_CHAT_ID` sert de choix explicite si plusieurs chats sont détectés. Au démarrage, `server/src/index.js` lance un minuteur d'une heure ; `server/src/telegram.js` envoie le bilan, les échecs terminaux de jobs et les erreurs HTTP 5xx. Les erreurs récupérées pendant un retry ne déclenchent pas d'alerte ; elles restent dans FULL TRACE. Les messages Telegram évitent les briefs, captures, détails d'erreur et secrets.
Les 28 briefs d'évaluation ne sont pas une mesure visuelle tant que les captures et scores réels n'ont pas été produits.
