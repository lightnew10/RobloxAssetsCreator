# Roblox Studio MCP

RobloxAssetsCreator utilise exclusivement le serveur MCP officiel livré avec Roblox Studio.

## Activation

1. Ouvre Roblox Studio.
2. Ouvre **Assistant**.
3. Clique sur **⋯ → Gérer les serveurs MCP**.
4. Active **Studio en tant que serveur MCP**.
5. Lance RobloxAssetsCreator.
6. Dans l'interface, sélectionne la fenêtre Studio détectée et clique sur **Autoriser cette fenêtre**.

Sous Windows, le serveur recherche automatiquement :

`%LOCALAPPDATA%\Roblox\mcp.bat`

Aucun plugin RobloxAssetsCreator n'est nécessaire.

## Outils utilisés

Selon les outils réellement exposés par ta version de Studio :

- `list_roblox_studios`
- `search_game_tree`
- `execute_luau`
- `screen_capture`
- `generate_mesh`
- `generate_procedural_model`
- `wait_job_finished`

Le mode **Parts contrôlées** a seulement besoin de `execute_luau` + `screen_capture`.
Le mode **Roblox natif** utilise les outils de génération asynchrone quand ils sont disponibles.
Le mode **Auto** tente le natif puis repasse sur Parts si nécessaire.

L'autorisation d'écriture est gardée uniquement en mémoire par le serveur et expire après 12 heures ou à la déconnexion de Studio.
