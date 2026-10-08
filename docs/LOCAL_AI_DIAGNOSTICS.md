# Dépannage de la planification Ollama

## Incident réel analysé
Job cocotier tropical, 2026-10-07 à partir de 23:14 UTC : trois tentatives du modèle texte `qwen3.5:9b`, chacune interrompue après 240 secondes sans réponse JSON. La planification a échoué avant Roblox Studio. Le journal ne permet pas d'affirmer si le modèle utilisait GPU, CPU ou la RAM.

## Modifications de transport
- Les appels Ollama utilisent dorénavant `stream: true` pour recevoir les fragments de contenu et d'éventuel raisonnement au fur et à mesure.
- Le raisonnement lui-même n'est pas copié dans les traces ; seulement un nombre de caractères et la progression.
- Délai d'INACTIVITÉ de 15 minutes par défaut ; remise à zéro lorsqu'un fragment réseau arrive ; limite globale de 60 minutes par requête. Les deux durées sont configurables dans server/.env.
- Un vrai timeout de planification ne rejoue plus trois fois automatiquement exactement le même appel. Choisir un autre modèle de planification, vérifier la mémoire ou augmenter les limites.
- Le contexte Ollama reste à 8 192 tokens par défaut et se règle par `OLLAMA_NUM_CTX`. Ce nombre n'est pas le nombre de tokens réellement envoyés : c'est la fenêtre de contexte demandée.

## Réglages `server/.env`
- `OLLAMA_IDLE_TIMEOUT_MS=900000` (15 minutes sans aucun fragment de réponse)
- `OLLAMA_MAX_DURATION_MS=3600000` (60 minutes au total par appel)
- `OLLAMA_NUM_CTX=8192` (fenêtre de contexte Ollama ; augmenter si nécessaire ET si la RAM/VRAM le permet)
Ces changements nécessitent un redémarrage du serveur.

## Utiliser un modèle plus fort pour le plan, sans changer le reste
Sur l'écran Nouvel asset :
1. IA texte : choisir le provider habituel (utilisé pour la géométrie).
2. IA planification : choisir le provider dédié (local ou externe).
3. Modèle de planification (facultatif) : laisser vide pour utiliser le modèle défini dans Paramètres IA ou saisir le nom exact d'un autre modèle disponible.
4. IA vision : choix séparé.
Exemple : le planificateur utilise un modèle distant tandis que géométrie et vision restent sur Ollama. Une clé API externe doit être configurée au préalable et les appels à des services tiers ont des coûts et implications de confidentialité spécifiques.

## Vérifier RAM et VRAM
- Sous Windows : ouvrir http://127.0.0.1:11434/api/ps pendant la génération. `size` représente la mémoire du modèle chargé, `size_vram` la part GPU ; consulter aussi la mémoire système et GPU dans le Gestionnaire des tâches.
- `ollama ps` dans un terminal, si Ollama est dans PATH, donne aussi les modèles chargés et leur placement (GPU/CPU selon la version).
- Ollama gère le placement des couches selon les ressources disponibles. Augmenter `OLLAMA_NUM_CTX` augmente potentiellement la consommation de mémoire ; une partie de calcul sur CPU/RAM peut être sensiblement plus lente.
- Vérifier que le modèle ne renvoie pas uniquement du raisonnement pendant un temps très long ; suivre les événements `AI_PROGRESS` dans FULL TRACE.

## Test de validation recommandé
1. Après git pull, redémarrer le serveur et réautoriser Roblox Studio (autorisation non persistante).
2. Refaire un job identique ; conserver le premier job échoué pour comparaison.
3. Vérifier un plan JSON validé, puis des variantes et captures ; consulter FULL TRACE.
4. En cas d'échec, noter les événements `AI_PROGRESS`, le code d'erreur et les champs `details`.
5. Exécuter `npm run verify` pour les tests automatisés ; les tests Studio exigent une intervention réelle sur le poste Windows.

Documentation Ollama :
- https://docs.ollama.com/api/chat
- https://docs.ollama.com/api/ps


## Incident `missing_parent` du cocotier, 2026-10-07 23:53 UTC
- `tronc`, `feuillage` et `noix` faisaient référence à `root_coconut_palm`, absent de `components`. Trois relations erronées apparaissaient six fois dans les erreurs, du fait d'une double détection.
- Le modèle `Model` est le conteneur implicite de l'asset ; les références à un `root_*` inexistant et partagé par plusieurs composants sont désormais détachées de façon déterministe, sans créer de Part fictive.
- Les parents manquants non reconnus comme conteneurs virtuels continuent d'être refusés ; les cycles et les relations avec un vrai parent ne sont pas masqués.
- Le planificateur conserve les réparations dans la trace `SPATIAL_PLAN_REPAIRED`.
- Le job rapporté utilisait encore l'ancien timeout de 240 s et trois tentatives, avec l'ancien message d'erreur ; cela suggère fortement un serveur non redémarré après le correctif, sans le prouver à distance.
- Vérifier `http://127.0.0.1:3001/api/health` : la réponse doit exposer `server.buildTag=spatial-root-repair-v1` après mise à jour. Fermer toutes les anciennes consoles/processus et relancer `start.bat`.
- Le frontend Vite ne changera plus silencieusement de 5173 vers 5174 si le port est occupé ; ce conflit doit être corrigé plutôt que contourné.


## Détection de serveur obsolète — start.bat
- Le démarrage vérifie maintenant les ports 3001 (API) et 5173 (interface) avant d'ouvrir les consoles. Il s'arrête avec une erreur lisible si un port est déjà occupé ; il ne tue **aucun** processus.
- L'interface affiche le champ `API ...` reçu de `/api/health`; la version `spatial-root-repair-v1` atteste que le correctif de relations est chargé, contrairement à une ancienne API.
- Si le navigateur utilise le port 5174, fermer cette ancienne instance et rouvrir 5173. Une interface sur 5174 n'est pas le chemin de démarrage attendu.


## Fermeture automatique des anciennes instances (Windows)

`start.bat` lance maintenant `scripts/cleanup-ports.ps1` avant les serveurs.
Il arrete les processus qui ecoutent sur **3001**, **5173** et **5174** (et un port `PORT` personnalise si defini dans l'environnement), puis verifie une deuxieme fois que les ports sont libres. Les parents Node des processus surveilles sont arretes pour eviter que `node --watch` ne relance aussitot une ancienne API.

**Attention** : la fermeture vise tous les processus en ecoute sur ces ports, y compris une application tierce qui utiliserait l'un de ces ports. Aucun autre port n'est cible. Les PID systeme ne sont pas tues et un echec de fermeture empeche le demarrage plutot que de masquer l'erreur. Cette fonction est active a la demande de l'utilisateur et s'applique uniquement au lancement via `start.bat`.

Si le systeme refuse l'arret d'un processus, fermer l'application concernee (ou redemarrer Windows) et relancer `start.bat`. Aucune elevation automatique en administrateur n'est tentee.

## Incident du 2026-10-08 — racines `Model` et réflexion sans JSON

- Les tentatives de planification ont échoué avant tout appel à Studio : `trunk_base.parentId` pointait vers `Model` puis `Model Roblox`, qui sont des noms de conteneur, pas des composants 3D à construire.
- Le réparateur les reconnaît désormais en tant que racines virtuelles **uniquement lorsqu'aucun composant réel ne porte cet identifiant ou ce nom**. Il supprime alors la référence `parentId` et laisse la pièce directement sous le `Model` Roblox créé par le constructeur. Les parents réels manquants restent des erreurs.
- Une autre tentative a émis plus de 58 000 caractères de réflexion sans produire de JSON. Un garde-fou `OLLAMA_MAX_THINKING_ONLY_MS` (360000 ms par défaut) interrompt cette situation en phase de planification.
- Après `AI_THINKING_STALLED` ou `AI_INVALID_JSON` avec contenu vide, l'essai suivant passe `think:false` comme paramètre de premier niveau de l'API Ollama. C'est une **récupération ciblée**, pas un changement global du modèle.
- Certaines versions d'Ollama peuvent ignorer la contrainte `format` avec `think:false` pour Qwen3.5. La validation AJV reste obligatoire ; un JSON mal formé ou non conforme est refusé. Un test réel sur Ollama est nécessaire.
- Les événements `SPATIAL_PLAN_REPAIRED`, `AI_PROGRESS` et `PLAN_AI_STRATEGY_CHANGED` permettent de différencier une réparation logique d'un échec de sortie IA.

Références : https://docs.ollama.com/capabilities/thinking ; https://github.com/ollama/ollama/issues/14645

Après ce correctif, la valeur attendue de `server.buildTag` sur `http://127.0.0.1:3001/api/health` est **`model-root-repair-v2`** ; `spatial-root-repair-v1` indique une ancienne version. Après `git pull origin main`, redémarrer `start.bat` pour charger le code mis à jour.


## Correctifs de diagnostic (octobre 2026)

- Planification locale : `think:false` dès le premier appel par défaut, avec le schéma JSON existant. Activer `OLLAMA_PLANNING_THINK=true` uniquement pour tester le raisonnement explicite.
- `OLLAMA_MAX_THINKING_ONLY_MS=90000` : garde-fou lorsque le modèle émet du `thinking` sans contenu final ; ce seuil ne remplace pas les délais maximum et d'inactivité Ollama.
- Une réponse terminée sans `content` est `AI_EMPTY_RESPONSE` (distinct d'un JSON non parsable et d'une erreur HTTP).
- Artefacts `ai_responses/*_invalid_raw` et `*_invalid_content` : réponse Ollama à l'origine d'un échec du schéma ; métriques de génération et motif d'arrêt disponibles dans `OLLAMA_STREAM_FINISHED`.
- Un retry du planificateur inclut la cause de l'échec précédent, et les vrais problèmes de structure restent validés strictement (pas de parent fictif ajouté automatiquement).
- Une génération native en échec n'est plus répétée trois fois à l'identique : en cas d'échec elle tente l'autre méthode native disponible puis bascule sur Parts uniquement si le moteur choisi est **Auto**.
- `NATIVE_GENERATION_RESULT` et `variant.native_method_failed` décrivent le `status`, le `jobId`, la méthode, et la cause réellement renvoyée par Roblox si elle existe.
- Le processus MCP conserve les derniers messages `stderr` (bornés). Pour les réponses `Failed` sans motif renvoyé, le diagnostic indique explicitement que la cause est **inconnue**, au lieu de la deviner.
- La page Activité donne accès à **Détails techniques**, et l'interface identifie l'API avec le tag `ollama-native-diagnostics-v3`.

### Procédure de test

1. Fermer les anciennes instances, `git pull origin main`, `start.bat` ; vérifier le tag API.
2. Tester **Parts** avec un cocotier et vérifier le plan, les 3 variantes et les captures.
3. Tester **Auto** : en cas d'échec natif, ouvrir **Détails techniques** sous `variant.native_method_failed` puis FULL TRACE et les artefacts `studio/*_response`.
4. Consulter `OLLAMA_REQUEST_SETTINGS` et vérifier `think:false` et le schéma dans l'artefact requête.
5. Si Roblox n'a pas fourni de motif à l'échec, transmettre la réponse `wait_job_finished`, les diagnostics MCP et la sortie de Studio. Aucun correctif local ne peut garantir la disponibilité du service Roblox.

**Portée** : ces changements corrigent le chemin de diagnostic et les relances à l'identique, pas les échecs externes du service de génération Roblox. Un test de bout en bout sous Windows/Studio reste indispensable.


## Profil recommandé pour 8 Go de VRAM

Le nouveau défaut est OLLAMA_NUM_CTX=8192, modifiable dans server/.env. Si une ancienne valeur 16384 y figure, la changer manuellement.
Défauts du code pour la sortie : OLLAMA_PLAN_NUM_PREDICT=3000, OLLAMA_GEOMETRY_NUM_PREDICT=2000, OLLAMA_REVIEW_NUM_PREDICT=900. Les valeurs déjà inscrites dans `server/.env` restent prioritaires. Après une sortie marquée `doneReason: length`, la tentative suivante de planification ou de primitives génériques utilise au moins 3000 ou 2000 tokens respectivement.
La géométrie procédurale est construite en JavaScript après la réponse compacte de l'IA, sans demander une liste de centaines de coordonnées.
Les requêtes Ollama locales texte et vision sont sérialisées et toutes envoyées avec keep_alive:0 ; les chargements sont plus lents mais évitent que les modèles résident simultanément en VRAM.
Au démarrage, GET /api/ps avertit si un modèle déjà chargé utilise partiellement le CPU et propose de réduire le contexte ou d'utiliser un modèle plus petit.
Conseil : modèle texte 7–8B en Q4_K_M, après comparaison de sa fiabilité sur les JSON. qwen3.5:9b reste configurable, sans garantie de chargement intégral sur une carte 8 Go.
Variables du SERVEUR Ollama : OLLAMA_FLASH_ATTENTION=1 et OLLAMA_KV_CACHE_TYPE=q8_0. Les définir dans l'environnement Windows qui lance Ollama, puis redémarrer ce service. Leur compatibilité dépend des versions et modèles.
Commande exploratoire : npm run benchmark:planning produit data/runtime/benchmark-planning.json en comparant une et deux étapes sur quatre briefs. Aucune stratégie expérimentale n'est activée automatiquement.

## Configuration de la génération générique locale — 8 Go

Dans server/.env : TEXT_MODEL=qwen3:8b, VISION_MODEL=qwen3-vl:4b-instruct, CRITIC_MODEL= (vide = vision).
Ces défauts s'appliquent aux nouvelles configurations, mais n'écrasent pas les modèles enregistrés dans Paramètres IA.
OLLAMA_NUM_CTX=8192. Nouveaux défauts du code : OLLAMA_PLAN_NUM_PREDICT=3000, OLLAMA_GEOMETRY_NUM_PREDICT=2000 et OLLAMA_REVIEW_NUM_PREDICT=900 ; vérifier les valeurs effectives de `server/.env` dans `OLLAMA_REQUEST_SETTINGS`.
Les appels Ollama locaux sont séquentiels, keep_alive:0. La première requête après changement de modèle peut être plus lente.
Variables d'environnement du processus OLLAMA (pas Node) : OLLAMA_FLASH_ATTENTION=1 et OLLAMA_KV_CACHE_TYPE=q8_0, sous réserve de compatibilité de la version.
GET /api/ps et GET /api/tags sont consultés au démarrage / bilan. Un modèle 7–8B quantifié Q4_K_M peut être préférable sur 8 Go ; surveiller ollama ps.
Le modèle de vision ne génère jamais le plan géométrique ; il extrait les caractéristiques visibles et critique les captures.

## Incident patch/rebuild du cocotier — 2026-10-08

Le modèle `qwen3:8b` a produit des sorties `doneReason: length`, parfois presque entièrement dans `thinking`, puis des JSON de plan incomplets. Le rebuild a échoué et a laissé `plan:null` dans ce job. Le patch suivant a proposé `frondWidth=0.125`, mais la construction a échoué dans `normalizeGeometry` avant Studio car elle lisait ce plan absent. Le patch proposé ne prouve donc aucun changement visuel.

Depuis le correctif, les appels structurés locaux désactivent le raisonnement par défaut, sauf choix explicite de planification. Après troncature, la relance bornée augmente la place réservée à la sortie. Le rebuild garde le plan antérieur et le restaure en cas d'échec ; une reprise d'un ancien job peut relire `plan_vN` dans ses traces. Redémarrer l'API pour charger le correctif. Pour le job concerné, demander un nouveau patch depuis une variante terminée, puis vérifier la nouvelle géométrie et les captures dans Studio. Aucun test automatisé ne démontre cette validation visuelle.
