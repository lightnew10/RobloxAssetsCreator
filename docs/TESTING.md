# Tests manuels

Avant les tests automatisés, lancer `npm install` à la racine, puis `npm test`.

Pour les corrections : dans Studio, générer un palmier Parts puis demander « palmes trop fines » en ciblant les palmes. Vérifier le patch proposé sur `frondWidth`, les opérations appliquées, `changed` et les captures avant/après. Demander ensuite « il manque des feuilles » ; vérifier une modification de `frondCount` et la revue ciblée. Répéter sur un rocher et un objet inconnu. Une correction sans effet doit afficher « Aucun effet » et rester exclue de la sélection ; une correction `resolved` ne devient exemple qu'après clic sur « Valider cette correction ». Ce scénario n'est pas couvert par les tests hors Studio.

Voir aussi [Diagnostics IA locale](LOCAL_AI_DIAGNOSTICS.md) pour les requêtes Ollama longues et le fournisseur de planification dédié.

## Test 1 — Pipeline Parts recommandé

C'est le premier test à faire.

1. `git pull origin main`
2. Lance `start.bat`.
3. Ouvre Roblox Studio sur une place vide.
4. Active **Assistant → ⋯ → Gérer les serveurs MCP → Studio en tant que serveur MCP**.
5. Dans l'interface, sélectionne la fenêtre Studio et clique **Autoriser cette fenêtre**.
6. Dans **Paramètres IA** :
   - texte local : ton modèle Qwen texte ;
   - vision locale : ton modèle Qwen VL ;
   - ou configure une clé externe.
7. Crée :
   - Nom : `Cocotier tropical`
   - Catégorie : `tree`
   - Sous-type : `coconut_palm`
   - Moteur : `Parts contrôlées`
   - Variantes : `3`
   - Brief :
     `Cocotier stylisé Roblox, tronc haut légèrement courbé et fin, couronne concentrée au sommet, longues feuilles de palmier segmentées et retombantes, feuilles bien séparées, quelques noix de coco sous la couronne, silhouette lisible, aucune grosse boule de feuillage.`

### Résultat attendu

- plan 3D visible dans l'interface ;
- pas de blocage définitif sur `missing_parent` ;
- 3 variantes minimum dans `Workspace/RobloxAssetsCreator_<job>` ;
- 3 captures par variante ;
- audit technique ;
- score visuel si le modèle vision fonctionne ;
- correction automatique bornée si la qualité est insuffisante ;
- état final **À valider** ;
- le bouton **Choisir + sauvegarder** copie l'asset dans `ServerStorage/RobloxAssetsCreator_Assets`.

## Test 2 — Référence image

Refais le cocotier avec 1 à 3 images de référence.

Vérifie dans FULL TRACE :
- artifact de référence ;
- requête d'analyse visuelle ;
- plan ;
- géométrie ;
- appels Studio ;
- captures ;
- critique.

## Test 3 — Patch utilisateur

Sur une variante terminée, écris par exemple :

`Les feuilles sont trop épaisses et trop courtes. Allonge-les et rends-les plus fines sans modifier la hauteur du tronc.`

Clique **Patch**.

Attendu : une nouvelle variante de correction est créée en conservant le plan actuel.

## Test 4 — Rebuild plan

Feedback :

`La structure générale est mauvaise : le feuillage commence trop bas et le tronc n'est pas assez haut. Refaire le plan.`

Clique **Rebuild plan**.

Attendu :
- nouveau planVersion ;
- anciennes variantes conservées ;
- nouveau lot de variantes ;
- historique visible.

## Test 5 — Redémarrage serveur

Pendant un job, ferme le serveur puis relance `start.bat`.

Attendu :
- le job devient **Interrompu** ;
- aucune reprise silencieuse sans accès Studio ;
- après réautorisation Studio, clique **Reprendre**.

## Test 6 — Moteur Roblox natif

Choisis **Roblox natif**.

Si ta version Studio expose `generate_mesh` / `generate_procedural_model` :
- job asynchrone Roblox ;
- attente via `wait_job_finished` ;
- modèle replacé dans la zone de review.

En mode **Auto**, si le natif échoue ou n'est pas disponible, le système repasse sur Parts.

## Test 7 — Circuit breaker

Si une même erreur bloquante revient trois fois de suite :
- tentative 1 : retry/réparation ;
- tentative 2 : stratégie alternative ;
- tentative 3 : stop ;
- l'incident doit apparaître dans FULL TRACE ;
- si Telegram est configuré dans `server/.env`, une alerte est envoyée.

Pour vérifier Telegram sans attendre une erreur : renseigner seulement le token dans `server/.env`, envoyer `/start` au bot dans un chat privé, lancer `npm run telegram:check`, puis démarrer l'API et vérifier le message « bot actif ». Si plusieurs chats ont envoyé `/start`, préciser `TELEGRAM_CHAT_ID`. Le statut horaire part une heure après le démarrage et chaque heure suivante ; le minuteur s'arrête avec l'API. Un job qui passe réellement à `failed` doit envoyer une seule alerte contenant son ID et son code, sans brief ni trace. Les tests automatisés utilisent une réponse Telegram simulée et ne vérifient pas la livraison réelle.

## Ce qu'il faut me renvoyer en cas de mauvais résultat

Pour diagnostiquer précisément :
- le nom du job ;
- une capture de l'interface ;
- les captures des variantes si elles existent ;
- le code/message d'erreur ;
- les artifacts pertinents visibles dans **FULL TRACE**.

Ne copie jamais ta clé API dans un message.

## Test additionnel — version diagnostic v3

Rejouer le même cocotier avec **Auto**, puis vérifier `API ollama-native-diagnostics-v3`, `OLLAMA_REQUEST_SETTINGS`, les erreurs natives détaillées, et le repli Parts si le service natif refuse. La validation locale doit être faite après la mise à jour depuis `main`.

## Test — Mode de génération (séparation stricte)

1. Mettre à jour `main` et ouvrir **Paramètres IA**. Le choix initial doit être **Sans IA Roblox**, même si un ancien fichier de paramètres ne contient pas la nouvelle clé.
2. Créer un cocotier avec les paramètres par défaut. Vérifier `job.generationMode=local`, `job.engine=parts`, `variant.engineUsed=parts` et l'absence totale de `generate_mesh` / `generate_procedural_model` dans les requêtes Studio.
3. Sélectionner **IA Roblox uniquement** et créer un nouveau job. Attendu : `job.engine=native`. En cas de `Failed`, une erreur native détaillée doit être visible, **sans** repli Parts.
4. Sélectionner **Local + IA Roblox** puis créer un job. Attendu : `job.engine=auto`, génération native si disponible, repli Parts si nécessaire, avec source effective visible sur chaque variante.
5. Vérifier que les scores locaux et natifs sont présentés séparément et qu'un changement des paramètres n'affecte pas le moteur d'un job créé auparavant.
6. Revenir à **Sans IA Roblox** avant de comparer notre générateur local à la référence Roblox.

## Test — Correction des sauvegardes JSON sous Windows

- Mettre à jour le projet et vérifier le tag API `windows-save-recovery-v5`.
- Créer un job, générer plusieurs variantes puis vérifier que les changements d'état et scores persistent après redémarrage.
- En cas de verrouillage transitoire du JSON, le serveur relance le `rename` (codes `EPERM`, `EACCES`, `EBUSY`) en conservant l'ancienne version lisible jusqu'au succès.
- Si le verrou persiste : `JOB_SAVE_BLOCKED` indique le chemin et le code Windows d'origine. Inspecter alors les autres serveurs Node, les synchroniseurs et antivirus. Ne pas supprimer le JSON existant.
- Les fichiers temporaires du job sont nettoyés en cas d'erreur. Les tests automatiques simulent les conflits de renommage et exécutent désormais la suite sur Linux et Windows.
- Ne pas renommer ni supprimer manuellement les jobs actifs et ne pas interrompre `start.bat` pour tenter de contourner un verrou transitoire.


## Tests de la génération paramétrique (automatisés)

- Les quatre archétypes : taille, coordonnées Y >= 0, graine déterministe, silhouettes et boîtes englobantes différentes entre compact et silhouette.
- Schéma ancien parts toujours accepté ; mapping des composants du plan.
- Exemple non choisi / note manquante / score < 8 jamais exporté dans dataset.jsonl.
- Stockage des exemples validés, similarité par catégorie et brief ; métriques de durée et corrections.
- Référence PNG : comparaison couleur spatiale expérimentale, sans modifier la note du modèle.

## Tests manuels requis dans Roblox Studio

Avant de comparer les captures, générer deux jobs successifs dans la même place Studio. Vérifier que le second apparaît à distance des trois variantes du premier, et que chacune de ses trois captures montre uniquement sa propre variante. Répéter une fois en mode natif si le générateur Roblox est disponible.

Pour le mode en série : lancer un job avec « Enchaîner les lots de 3 » et laisser le nombre de lots vide, attendre au moins deux lots, noter une variante terminée deux fois pendant la génération, vérifier les deux entrées de l'historique, puis cliquer « Arrêter ». Relancer avec 3 lots (puis, si possible, 5 ou 10) et vérifier le passage automatique en `review_ready` après exactement 9 variantes de base pour 3 lots, sans démarrage du quatrième. Vérifier que les variantes précédentes restent visibles dans le tableau et que seul « Choisir et sauvegarder » effectue une validation pour la bibliothèque. Tester un Patch et un Rebuild depuis une ligne du tableau et contrôler la filiation de la nouvelle variante.

1. git pull origin main, puis redémarrer start.bat, autoriser Studio et sélectionner Sans IA Roblox.
2. Générer trois cocotiers ; examiner courbure, palmes et noix et comparer les bounding boxes ; aucune requête native Roblox ne doit apparaître.
3. Générer arbre feuillu, rocher et maison ; inspecter les surfaces au sol, positions et proportions.
4. Essayer un prop inconnu : le mode Parts libre historique doit continuer de fonctionner.
5. Sélectionner une variante notée au moins 8/10, puis vérifier data/runtime/examples.jsonl ; un modèle non sélectionné ne doit jamais y entrer.
6. Lancer npm run export:dataset ; vérifier les rôles system/user/assistant et les exemples réellement validés.
7. Inspecter data/runtime/metrics.jsonl : score, durée et corrections.
8. Fournir image PNG de référence et vérifier REFERENCE_SIMILARITY_EXPERIMENT. Le score de comparaison histogramme ne doit pas remplacer l'avis visuel.
9. Vérifier OLLAMA_REQUEST_SETTINGS : contexte 8192, numPredict borné, keepAlive=0, et suivre le chargement GPU/CPU.
10. Exécuter éventuellement npm run benchmark:planning et comparer les sorties sur les mêmes briefs. Deux étapes non activées par défaut.

Ces essais Studio, Ollama réel et validité visuelle ne sont pas exécutables par CI ; ne pas les déclarer réussis sans contrôle manuel.

## Tests de la refonte générique

La CI exécute npm run verify sous Ubuntu et Windows : tests unitaires du serveur, build Vite puis 28 fixtures statiques de catégorie/gabarit.
Les tests manuels (non exécutés en CI) :
1. Ouvrir une place Roblox Studio vide, autoriser MCP, sélectionner Sans IA Roblox.
2. Décrire un crayon ou une poignée low-poly, taille en studs, maxParts 180 et 3 variantes. Activer « Examiner la décomposition ». Vérifier l'inventaire, changer un composant JSON, valider ; la génération doit reprendre.
3. Vérifier les pièces, pivot au sol, noms des sous-Models, captures face/profil/haut, et l'absence de génération Roblox native.
4. Tester sweep (branche), revolve (bouteille), extrude (profil), cone (abat-jour) ; détecter les limites de la géométrie facettée.
5. Tester une référence photo PNG : vision LOCALE, critique et diagnostics de similarité sans fuite vers un provider externe.
6. Donner une note humaine de 7 : pas d'entrée dans library.jsonl. Donner 8 : une entrée structurée avec la décomposition. L'asset doit être sauvegardé dans ServerStorage.
7. npm run export:dataset doit écrire data/exports/dataset.jsonl et exclure les exemples sans note humaine, les notes inférieures à 8 et les assets natifs Roblox.
8. Vérifier FULL TRACE, interrompre et reprendre un job ; tester Ollama arrêté et Studio déconnecté.
9. Exécuter npm run eval:fixtures : il ne mesure que les contrôles statiques et ne génère aucune note de ressemblance.
10. Noter et capturer les 28 briefs dans data/eval/objects.json avant de prétendre que la qualité visuelle progresse.
