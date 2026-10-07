# Instructions pour les agents — RobloxAssetsCreator

## Mission et périmètre
RobloxAssetsCreator est une application autonome consacrée UNIQUEMENT à la création d'assets 3D Roblox. Priorité : fidélité au brief et aux références, silhouette reconnaissable, structure correcte, qualité visuelle, performance en jeu, puis vitesse et coût. Ne pas réintroduire MyRGame, des fonctions de jeu, de terrain ou de map builder dans ce dépôt. Préserver une future intégration par API, sans couplage à MyRGame.

## Avant toute modification
1. Lire AI_INDEX.md, puis seulement la documentation et les fichiers de code pertinents.
2. Vérifier l'état réel de la branche, le code et les tests ; les documents ne remplacent pas le code comme source de vérité.
3. Examiner docs/ARCHITECTURE.md, docs/ASSET_PIPELINE_V2.md et prompts/README.md selon la tâche.
4. Identifier les contrats JSON et les dépendances avant de modifier le moteur ; rechercher les tests existants.
5. Distinguer explicitement ce qui existe de ce qui est une proposition de refonte.
6. Respecter le feedback utilisateur et les décisions déjà validées ; ne pas inventer des spécifications absentes.

## Mode de travail : aller au bout de la tâche
- Pour une demande d'implémentation, planifier brièvement si nécessaire, puis développer, tester, corriger et documenter sans demander la permission entre les étapes déjà autorisées.
- Ne pas arrêter après une étape ou avec un simple plan alors que l'exécution a été demandée.
- En mode Plan explicitement choisi, produire le plan : ne pas contourner ce mode.
- Demander à l'utilisateur seulement une information indispensable, une autorisation requise, une décision à fort impact ou un test humain impossible à exécuter.
- Après des échecs récupérables, tenter une réparation bornée et documenter la cause ; ne jamais boucler indéfiniment.
- À la fin, fournir les modifications, les vérifications réellement exécutées, leurs résultats et les limites. Ne jamais affirmer qu'une génération Roblox ou qu'une intégration locale fonctionne sans l'avoir testée.

## Architecture actuelle : contrats à préserver
- Orchestration : server/src/pipeline.js ; providers : server/src/providers.js et providerSettings.js.
- Prompts ACTIFS actuels : server/src/prompts.js. Les fichiers du dossier prompts/presets sont des spécifications de travail, PAS des prompts injectés automatiquement.
- Plan : server/src/spatialPlan.js ; maximum actuel de 24 composants normalisés ; parentId doit référencer un id présent, sans cycle.
- Géométrie Parts : server/src/geometry.js ; maximum actuel 180 Parts ; formes box, cylinder, ball, wedge ; propriétés name, componentId, shape, size, position, rotation, color, material, canCollide.
- Construction Roblox : server/src/assetStudio.js ; variantes natives via generate_mesh / generate_procedural_model, si disponibles, ou Parts.
- Contrôles : captures, qualityPolicy, recovery, trace, learning ; conserver FULL TRACE et la sélection humaine avant sauvegarde définitive.
- Toute évolution des schémas, limites, paramètres ou étapes nécessite validation de schéma, tests de compatibilité et plan de migration. Ne pas injecter dans le runtime des champs que ses validateurs ne comprennent pas.

## Stratégie 3D — ne pas limiter arbitrairement la solution aux Parts
Choisir le procédé adapté à l'objet et à la cible, plutôt qu'un seul procédé universel :
1. Parts / primitives / génération procédurale paramétrique : formes simples, éditabilité, collisions et performances, arbres stylisés lorsque le résultat est convaincant.
2. Meshes (Roblox generate_mesh ou autre chaîne 3D validée) : feuilles courbes, rochers complexes, troncs organiques, surfaces où les Parts dégradent la silhouette.
3. Hybride : squelette et collisions avec Parts ; détails organiques en MeshParts ; textures uniquement lorsque les UV / surfaces les justifient.
4. Texture, Decal et SurfaceAppearance : améliorer l'aspect visuel sans masquer des erreurs de géométrie. Une texture 2D ne corrige PAS une silhouette 3D incorrecte.
5. ComfyUI Desktop : candidat optionnel pour générer des références, decals et images de textures ; son intégration n'est PAS encore implémentée. Vérifier réellement la disponibilité de son API, du workflow, des modèles et des droits d'import Roblox avant de l'utiliser.
Toujours justifier le choix du procédé par le besoin visuel, l'éditabilité, les limites Roblox, le temps/coût et les tests.

## Prompts et modèles IA
- Utiliser prompts/README.md et les presets versionnés comme base de conception. Leur mise en production exige un branchement explicite dans le runtime.
- Pour les petits modèles locaux, formuler des tâches courtes, spécialisées, contraintes par un schéma exact, avec critères vérifiables ; éviter les longues consignes contradictoires.
- Conserver le brief et les références originaux. Ne pas fabriquer les détails invisibles ni réduire le résultat à des sphères/cubes génériques sans justification.
- Séparer analyse visuelle, planification, géométrie, critique et réparation. Ne pas confondre critique esthétique avec contrôle technique.
- Générer 3 variantes véritablement différentes par défaut ; enregistrer la sélection et les corrections validées sans considérer tout feedback comme vérité.
- Comparer modèles locaux et externes sur un même jeu de cas. Mesurer qualité, erreurs, latence et coût ; aucune promesse de performance non mesurée.

## Qualité, tests et sécurité
- Avant de modifier le pipeline, créer ou préserver des tests de non-régression. Commande projet : npm run verify (tests serveur + build web). Consulter docs/TESTING.md pour les tests manuels Studio.
- Cas prioritaires : cocotier, feuillu, rocher, maison ; silhouette, proportions, composants absents, stabilité parent/enfant, nombre de Parts/triangles, captures et boucle de correction.
- Garder des bornes aux retries ; diagnostiquer les mêmes erreurs via FULL TRACE plutôt que relancer en boucle.
- Ne pas committer clés API, tokens, images privées, données runtime ou traces sensibles. Garder les secrets côté serveur. Ne pas publier d'images/textures sur Roblox ou envoyer des données à un service externe sans autorisation appropriée.
- Ne pas écrire ou écraser les fichiers propres à l'utilisateur ; préserver les assets déjà sauvegardés. Tout téléchargement/import doit respecter les droits sur les images.

## Documentation durable
- Maintenir AI_INDEX.md comme porte d'entrée minimale et les documents ciblés à jour après les changements qui modifient réellement leur contenu.
- Ne pas modifier l'index à chaque microchangement ; documenter les décisions durables et les limitations connues.
- Garder les prompts/presets cohérents avec les schémas du code ; si le code change, actualiser les presets et leurs versions.
- Obsidian peut ouvrir ces fichiers Markdown ou une copie synchronisée ; aucune synchronisation Obsidian automatique n'est supposée en place.
