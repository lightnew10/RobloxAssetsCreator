# Proposition d'évolution — Asset Pipeline V2

Statut : **CONCEPTION / FEUILLE DE ROUTE**, pas une implémentation livrée.
But : augmenter de façon mesurable la ressemblance avec les références, la qualité de silhouette et la robustesse, sans casser le pipeline ni la génération Parts actuelle.

## État existant observé
- Chaîne présente : brief, référence vision, spatialPlan, réparation structurelle, variantes, moteur Parts ou outils natifs Roblox, audit, captures, review, corrections bornées, choix humain, FULL TRACE.
- Contrat de plan actuel : 24 composants normalisés maximum ; relations parent/enfant réparées et vérifiées dans spatialPlan.js.
- Géométrie Parts actuelle : 180 pièces maximum, quatre formes primitives ; geometry.js et assetStudio.js.
- Mode natif : generate_mesh ou generate_procedural_model via Roblox Studio MCP ; route déjà présente.
- Limitation : ce vocabulaire géométrique peut être insuffisant pour des feuillages complexes, rochers organiques ou silhouettes courbes ; il faut le vérifier par des tests.

## Proposition d'architecture

    Brief / images / contraintes utilisateur
      -> Normalisation non destructive du brief (nouveau, facultatif)
      -> Observation des références (faits vs inconnues)
      -> Spécification visuelle / critères mesurables
      -> Plan d'assemblage indépendant du moteur
      -> Décision de représentation par composant
         [Parts / ProceduralModel / MeshPart / Hybride]
      -> Construction et audit technique
      -> Habillage [matériaux, textures, decals, SurfaceAppearance] si pertinent
      -> Captures multi-vues / comparaison références
      -> Patch ciblé ou reconstruction bornée
      -> Sélection et validation humaine / mémoire des leçons

**Important :** ne pas forcer toutes les sorties par le JSON Parts actuel : les chemins mesh et texture demanderont des contrats propres, versionnés et testés. Un mesh n'est pas une texture ni un simple Decal.

## Choix de représentation
- Parts : géométrie simple / collisions / modifiabilité ; optimisation du nombre de pièces et courbes segmentées.
- ProceduralModel Roblox : structures paramétrables, si l'outil et la catégorie s'y prêtent.
- generate_mesh Roblox : relief et silhouettes organiques ; vérifier disponibilité MCP, contraintes de triangles, qualité et possibilités de modification.
- Hybride : structure et ancrages en Parts ; surfaces organiques en mesh ; optimisation des collisions.
- Texture/Decal sur Part : détails 2D. SurfaceAppearance et PBR sur MeshPart : nécessite UV et images compatibles ; ne remplace pas la géométrie.
- ComfyUI Desktop : génération optionnelle de concepts, decals et textures 2D. Aucune intégration opérationnelle garantie par ce document.

## Modifications envisagées — ordre recommandé
### P0 — mesure et références
1. Conserver le mode actuel inchangé ; créer un jeu de tests reproductible.
2. Tester cocotier, feuillu, rocher, maison, avec et sans référence.
3. Mesurer silhouette, fidélité au brief, proportions, visibilité des composants, faisabilité technique, pièces/triangles, durée/coût, nombre de corrections.
4. Captures fixes, consignes identiques, mêmes réglages quand possible ; journaliser les différences de fournisseur et seeds disponibles.

### P1 — qualité du plan et des prompts
5. Construire un brief normalisé non destructif et une liste de critères essentiels.
6. Adapter les prompts pour les petits modèles, en conservant les schémas de sortie ; A/B contre les prompts existants.
7. Corriger les cas de composants manquants, relations invalides et géométries dégénérées par validations déterministes.
8. Définir des variantes réellement distinctes en géométrie (et pas uniquement en couleur).

### P2 — moteur de représentation hybride
9. Introduire un contrat V2 versionné pour le choix du moteur par composant, sans supprimer le contrat Parts existant.
10. Tester MeshPart natif / ProceduralModel dans le flux et préserver la marche arrière.
11. Vérifier collisions, ancrage, orientation, matériaux, regroupement, bounds, limites Studio et coût en jeu.
12. N'accepter un moteur plus complexe que s'il améliore les benchmarks.

### P3 — textures et ComfyUI
13. Tester manuellement un workflow ComfyUI Desktop pour une texture répétable, un decal et une référence d'asset.
14. Ajouter éventuellement un client local optionnel, paramétrable ; ne pas coder de port supposé ni de dépendance obligatoire.
15. Valider l'usage d'images sur Parts et meshes, les UV, la résolution, la licence et les autorisations d'import Roblox.
16. Comparer visuellement sans textures, puis avec textures, pour mesurer la valeur ajoutée.

### P4 — boucle de correction et apprentissage
17. Différencier erreur de géométrie, de texture, de capture, de provider et de référence.
18. Patch ciblé avec invariants de composants ; rebuild seulement quand nécessaire ; circuit breaker existant conservé.
19. Promouvoir les leçons après choix humain ; éviter qu'un échec ou une note IA isolée devienne une vérité durable.
20. Exposer dans l'interface pourquoi une variante a été acceptée/rejetée et quels changements ont été appliqués.

## Critères d'acceptation
Ces critères sont des objectifs proposés, PAS des résultats de test.
- Aucun JSON invalide accepté silencieusement ; audits fiables avant construction.
- Aucune référence parent inexistante après validation ; erreurs signalées clairement.
- Trois variantes initiales différenciables par silhouette et construction lorsque demandées.
- Une variante ne peut être considérée comme acceptée sans critères essentiels vérifiés ; revue humaine conservée.
- Aucune régression fonctionnelle sur le pipeline Parts.
- Exécution de npm run verify et de docs/TESTING.md ; conserver artefacts et captures avant/après.
- Mesurer l'amélioration sur dataset fixe ; ne pas imposer arbitrairement un seuil qualité non validé par l'utilisateur.

## Ce que la V2 ne promet PAS encore
Pas de conversion texte -> mesh par ComfyUI seul ; pas d'auto-UV ; pas d'import Roblox sans autorisation ; pas de garantie qu'un gros modèle IA élimine les limites du constructeur ; pas de génération validée sans test Studio.

## Documentation officielle
- https://create.roblox.com/docs/studio/mcp
- https://create.roblox.com/docs/parts/textures-decals
- https://create.roblox.com/docs/art/modeling/surface-appearance
- https://create.roblox.com/docs/parts/procedural-models
