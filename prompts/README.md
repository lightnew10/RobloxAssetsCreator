# Presets de prompts — conception / expérimentation

IMPORTANT : ces fichiers sont des presets DOCUMENTAIRES, non chargés par le serveur actuellement.
Les prompts actifs résident dans server/src/prompts.js et dans certains appels directs de server/src/pipeline.js.
Le prompt actif de questions avant Patch/Rebuild réside dans `server/src/change/clarification.js` ; il produit zéro à trois questions, pas une définition géométrique. Voir `docs/CORRECTION_CLARIFICATION.md`.
Les prompts de patch et de revue ciblée actifs sont `patchSystem`, `patchUser` et `targetedReviewSystem` dans `server/src/prompts.js` ; les presets de ce dossier restent documentaires.
Leur branchement nécessite un loader, une sélection par étape/provider, une validation des schémas et des tests.

## Presets proposés et correspondances
- 00-brief-normalizer.md : clarifier le brief ; nouvelle étape facultative, non existante.
- 10-reference-vision.md : analyzeReferences dans pipeline.js ; correspond à referenceSchema.
- 20-spatial-planner.md : buildPlan ; correspond à spatialPlanSchema.
- 30-parts-geometry.md : makeGeometry ; correspond à geometrySchema.
- 40-native-mesh.md : construire un prompt pour generate_mesh ou generate_procedural_model, chemin existant.
- 50-visual-critic.md : reviewVariant ; correspond à reviewSchema.
- 60-targeted-repair.md : stratégie de réparation proposée, contrat spécifique encore à concevoir.
- 70-comfyui-textures.md : création d'images et de textures, optionnelle et non intégrée.
- 80-small-model-adapter.md : condenser les consignes pour IA locales ; étape optionnelle non intégrée.

## Règles de composition
1. Conserver séparément message système spécialisé, entrée utilisateur originale, schéma JSON et contexte vérifié.
2. Remplacer les champs entre chevrons (ex. <BRIEF>) à l'exécution, ne jamais transmettre les exemples comme des faits.
3. Passer seulement le résultat de l'étape précédente indispensable à l'étape suivante.
4. Ne demander que les champs autorisés par le schéma du runtime (voir server/src/spatialPlan.js, geometry.js et pipeline.js).
5. Ne pas contraindre tous les modèles à un très long prompt identique ; tester des formulations courtes sur modèles locaux.
6. Interdire les hypothèses non justifiées à partir d'une image ; signaler plutôt les informations non observables.
7. Garder les contraintes utilisateur, les interdits et les faits vérifiés prioritaires sur les optimisations stylistiques.
8. Journaliser version du preset, modèle, paramètres, identifiant du job et résultat ; ne jamais enregistrer une clé secrète.

## Mise en service future
- Phase 1 : tests A/B manuels des prompts, captures et FULL TRACE.
- Phase 2 : loader de prompts avec version et valeurs par défaut conservant le comportement actuel.
- Phase 3 : injection progressive par étape, comparaison sur les mêmes cas (cocotier, feuillu, rocher, maison).
- Phase 4 : activation choisie par provider et rollback immédiat ; aucune régression imposée.

## Format
Les exemples JSON sont des contrats indicatifs. Pour la sortie produite par un modèle, privilégier JSON seul, sans Markdown, et faire appliquer la validation par du code déterministe.
