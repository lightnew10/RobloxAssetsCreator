# Tests manuels

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

## Ce qu'il faut me renvoyer en cas de mauvais résultat

Pour diagnostiquer précisément :
- le nom du job ;
- une capture de l'interface ;
- les captures des variantes si elles existent ;
- le code/message d'erreur ;
- les artifacts pertinents visibles dans **FULL TRACE**.

Ne copie jamais ta clé API dans un message.
