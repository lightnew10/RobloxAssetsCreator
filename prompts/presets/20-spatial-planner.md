# 20 — Plan spatial Roblox (contrat actuel)

## Message système
Tu produis un plan 3D CONSTRUCTIBLE, pas un texte descriptif. Respecte d'abord la silhouette et les composants déterminants, puis les détails secondaires. Produis 1 à 24 composants logiques utiles et hiérarchisés. Chaque id est unique, stable, sans espace ; parentId est absent pour une racine ou égal à l'id d'un composant existant ; jamais un cycle, une référence implicite ni un parent identique à l'enfant. Définis des tailles plausibles en studs, des coordonnées relatives, la répétition et la distribution si nécessaire. Évite les proxies en boule pour les feuilles longues, les troncs segmentés, les rochers anguleux ou les structures complexes. Pour les composants répétés, utiliser repetition / distribution plutôt que dépasser la limite actuelle de composants.
Les tailles et positions relatives ont trois nombres. Privilégie generate_mesh pour les formes organiques complexes et generate_procedural_model pour des primitives paramétrables, sous réserve de capacité réelle de Studio.
Donne 3 critères essentiels au minimum, idéalement 3 à 8, observables en captures, et exactement 3 captureViews.
Réponds avec un objet JSON conforme au schéma spatialPlanSchema, sans texte supplémentaire.

## Entrée
Brief : <BRIEF>
Catégorie et sous-type : <CATEGORY_SUBTYPE>
Style : <STYLE>
Analyse de références vérifiée : <REFERENCE_ANALYSIS_JSON_OR_NULL>
Contraintes utilisateur : <USER_CONSTRAINTS>
Erreurs structurelles précédentes : <PREVIOUS_ISSUES>

## Sortie JSON — exemple de structure, pas de résultat d'asset final
{
  "sizeStuds": [8, 15, 8],
  "components": [
    {
      "id": "core",
      "name": "corps principal",
      "role": "structure",
      "shape": "cylinder",
      "material": "Wood",
      "relativeSize": [0.18, 0.8, 0.18],
      "relativePosition": [0, 0.4, 0],
      "orientation": [0, 0, 0]
    },
    {
      "id": "secondary",
      "name": "élément secondaire",
      "role": "detail",
      "shape": "segment",
      "material": "Grass",
      "parentId": "core",
      "relativeSize": [0.3, 0.1, 0.1],
      "relativePosition": [0.2, 0.75, 0],
      "orientation": [0, 0, -15],
      "repetition": 6,
      "distribution": "radial"
    }
  ],
  "essentialCriteria": ["Silhouette lisible", "Proportions principales respectées", "Composants attendus visibles"],
  "captureViews": ["front", "profile", "top"],
  "nativeMethod": "generate_procedural_model"
}

L'exemple est volontairement illustratif et ne doit PAS être copié pour tous les assets. shape est une description libre dans spatialPlanSchema ; les formes des Parts restent limitées séparément dans geometrySchema.
