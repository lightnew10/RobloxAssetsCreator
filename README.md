# RobloxAssetsCreator

Application autonome dédiée uniquement à la création d'assets 3D Roblox.

## Objectif

Transformer un brief d'asset (ex. cocotier, cerisier, rocher, maison, mobilier) en plusieurs variantes 3D directement dans Roblox Studio, avec :

- connexion au serveur MCP officiel de Roblox Studio ;
- plan 3D structuré avec réparation automatique des relations `missing_parent` ;
- 3 variantes distinctes par défaut ;
- génération par Parts ou génération native Roblox (`generate_mesh` / `generate_procedural_model`) ;
- captures Studio multi-vues ;
- critique visuelle IA ;
- boucle de correction ;
- corrections patch/rebuild depuis une variante source, avec historique, revue ciblée et validation humaine des exemples ;
- sélection humaine puis sauvegarde dans `ServerStorage/RobloxAssetsCreator_Assets` ;
- providers IA local Ollama, OpenAI, Claude, DeepSeek, Gemini et OpenRouter ;
- clés API stockées côté serveur ;
- FULL TRACE des appels IA, plans, géométries, captures, décisions et erreurs ;
- récupération automatique des erreurs répétées avec circuit breaker au troisième échec identique.

## Démarrage rapide

Pré-requis : Node.js 20.19+, Roblox Studio récent, et sous Windows le serveur MCP officiel de Studio activé.

1. Dans Roblox Studio : **Assistant → ⋯ → Gérer les serveurs MCP → Studio en tant que serveur MCP**.
2. Lancer `start.bat`, ou :
   - `npm install`
   - `npm run dev:server`
   - `npm run dev:web`
3. Ouvrir `http://127.0.0.1:5173`.
4. Autoriser la fenêtre Roblox Studio dans l'interface.
5. Configurer le provider IA et le mode de génération 3D dans **Paramètres IA**. Sans changement, la génération IA native Roblox est désactivée.
6. Décrire l'asset et lancer la création.

Les données runtime, clés et traces restent locales dans `data/` et sont ignorées par Git.

## Alertes Telegram

Le serveur utilise le bot Telegram déjà créé : aucun processus supplémentaire n'est nécessaire. Dans `server/.env` (fichier local ignoré par Git), renseigner seulement :

```dotenv
TELEGRAM_BOT_TOKEN=token_fourni_par_BotFather
```

Envoyer `/start` au bot dans une conversation privée, puis lancer `npm run telegram:check` pour recevoir un message de test. Le serveur retrouve automatiquement cet unique chat et conserve son identifiant dans `data/runtime/telegram-chat.json` (ignoré par Git). Si `/start` est envoyé après le lancement de l'API, elle réessaie toutes les 30 secondes. Si plusieurs chats privés ont envoyé `/start`, indiquer explicitement `TELEGRAM_CHAT_ID` dans `server/.env` ; `npm run telegram:chat-id` peut afficher les identifiants possibles. `start.bat` (ou `npm run dev:server`) active les notifications : confirmation au démarrage, alerte lors d'un échec de job ou d'une erreur serveur, et statut toutes les heures tant que le serveur fonctionne. Le statut compte les jobs actifs, les variantes achevées et les jobs prêts ou en erreur pendant la dernière heure. Redémarrer le serveur après toute modification de `server/.env`.

Le bot envoie uniquement des codes d'erreur et des identifiants de job, sans brief, image, trace complète ni clé. Si Telegram est indisponible, la génération continue et un avertissement apparaît dans le journal local. Le token donne accès au bot : ne pas le publier ni le coller dans une conversation.

## Pipeline

`Brief → Plan 3D → Validation/repair → Variantes → Construction Studio → Audit technique → Captures → Critique IA → Correction → Review humaine → Sauvegarde`

Le projet ne contient volontairement ni système de jeu, ni map builder, ni workflow MyRGame général : uniquement la création d'assets 3D.

## Choix du générateur 3D

Dans **Paramètres IA** (en haut à droite), choisir le comportement des **nouvelles créations** :

- **Sans IA Roblox** (défaut) : le modèle configuré planifie la géométrie, le pipeline construit des Parts dans Roblox Studio via MCP. Aucun appel aux outils de génération IA native de Roblox.
- **IA Roblox uniquement** : les outils `generate_mesh` / `generate_procedural_model` de Roblox produisent la géométrie. Pas de repli vers Parts si la génération native échoue. Le modèle texte/vision configuré peut toujours participer à la planification et à la critique.
- **Local + IA Roblox** : essaie le générateur natif disponible, et se replie vers notre géométrie Parts lorsque nécessaire.

La préférence est sauvegardée dans `data/provider-settings.json` et appliquée côté serveur. Un ancien formulaire ne peut pas la contourner en envoyant un moteur différent. Chaque job fige son mode à la création ; modifier le réglage ne change pas les créations existantes.

Les variantes conservent `engineUsed` et `generationSource` : `roblox_native` ou `local_parts`. Les moyennes de notes sont affichées séparément pour chaque moteur afin d'éviter d'attribuer les performances de Roblox à notre pipeline local.

**Important :** « Sans IA Roblox » désactive la **génération géométrique native**, pas l'utilisation de Roblox Studio comme outil de construction et de capture. Le fournisseur IA texte/vision reste configurable séparément.


## Géométrie déterministe et apprentissage structuré

- server/src/archetypes/ : palmTree, broadleaf, rock et house exportent { id, schema, build(params) }.
- Ollama propose un archétype et quelques paramètres, non les positions de chaque Part. Le builder produit le format historique. Les modes Parts libre et Roblox natif subsistent.
- data/runtime/examples.jsonl : stockage des sélections humaines >= 8/10, avec brief, plan, archétype, paramètres, score et critique. Les leçons textuelles sont conservées.
- npm run export:dataset : produit un dataset.jsonl au format chat pour une utilisation future ; aucun entraînement.
- data/runtime/metrics.jsonl : temps, note finale, corrections.
- 8 Go de VRAM : OLLAMA_NUM_CTX=8192 par défaut, keep_alive:0 et texte/vision séquentiels.
- npm run benchmark:planning compare deux architectures sur les mêmes briefs ; le benchmark n'active rien dans la production.

## Nouveau mode générique low-poly (phase d'intégration)

Les nouveaux jobs utilisent une classification à 8 catégories, un inventaire de composants, puis une décomposition JSON en primitives génériques (sweep/cone/revolve/extrude, etc.). Les profils modifient des proportions, et les Parts sont construites par un interpréteur déterministe. Les modules palmTree/broadleaf/rock/house restent comme chemin historique de compatibilité, non comme condition pour chaque nouvel objet.
Active « Examiner la décomposition » si tu veux modifier les composants avant construction. Le score attribué par l'IA et la note humaine sont distincts ; seul un choix noté au moins 8 par l'utilisateur peut enrichir la bibliothèque locale.
`npm run verify` inclut tests, build, 28 briefs de référence (statiques) et export du dataset. Les mesures visuelles exigent Studio.
Voir docs/ARCHITECTURE.md, docs/PRIMITIVES.md, docs/CATEGORIES.md, docs/LIBRARY.md et docs/EVALUATION.md.
Pour les contrats de correction et la reprise d'un rebuild échoué, voir [docs/CORRECTIONS.md](docs/CORRECTIONS.md) et [docs/LOCAL_AI_DIAGNOSTICS.md](docs/LOCAL_AI_DIAGNOSTICS.md). Les anciennes valeurs de `server/.env` peuvent limiter la sortie Ollama malgré des défauts du code plus élevés ; consulter `OLLAMA_REQUEST_SETTINGS` dans FULL TRACE.
