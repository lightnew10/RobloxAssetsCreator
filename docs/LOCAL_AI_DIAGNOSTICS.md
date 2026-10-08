# Dépannage de la planification Ollama

## Incident réel analysé
Job cocotier tropical, 2026-10-07 à partir de 23:14 UTC : trois tentatives du modèle texte `qwen3.5:9b`, chacune interrompue après 240 secondes sans réponse JSON. La planification a échoué avant Roblox Studio. Le journal ne permet pas d'affirmer si le modèle utilisait GPU, CPU ou la RAM.

## Modifications de transport
- Les appels Ollama utilisent dorénavant `stream: true` pour recevoir les fragments de contenu et d'éventuel raisonnement au fur et à mesure.
- Le raisonnement lui-même n'est pas copié dans les traces ; seulement un nombre de caractères et la progression.
- Délai d'INACTIVITÉ de 15 minutes par défaut ; remise à zéro lorsqu'un fragment réseau arrive ; limite globale de 60 minutes par requête. Les deux durées sont configurables dans server/.env.
- Un vrai timeout de planification ne rejoue plus trois fois automatiquement exactement le même appel. Choisir un autre modèle de planification, vérifier la mémoire ou augmenter les limites.
- Le contexte Ollama reste à 16 384 tokens par défaut et se règle par `OLLAMA_NUM_CTX`. Ce nombre n'est pas le nombre de tokens réellement envoyés : c'est la fenêtre de contexte demandée.

## Réglages `server/.env`
- `OLLAMA_IDLE_TIMEOUT_MS=900000` (15 minutes sans aucun fragment de réponse)
- `OLLAMA_MAX_DURATION_MS=3600000` (60 minutes au total par appel)
- `OLLAMA_NUM_CTX=16384` (fenêtre de contexte Ollama ; augmenter si nécessaire ET si la RAM/VRAM le permet)
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
