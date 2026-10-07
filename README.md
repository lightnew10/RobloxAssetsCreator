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
5. Configurer le provider IA dans **Paramètres IA**.
6. Décrire l'asset et lancer la création.

Les données runtime, clés et traces restent locales dans `data/` et sont ignorées par Git.

## Pipeline

`Brief → Plan 3D → Validation/repair → Variantes → Construction Studio → Audit technique → Captures → Critique IA → Correction → Review humaine → Sauvegarde`

Le projet ne contient volontairement ni système de jeu, ni map builder, ni workflow MyRGame général : uniquement la création d'assets 3D.
