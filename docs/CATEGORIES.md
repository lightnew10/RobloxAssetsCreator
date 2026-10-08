# Gabarits de catégories

Les gabarits sont des fichiers markdown versionnés dans `prompts/categories/` :
handheld, vehicle, building, vegetation, animal, furniture, infrastructure, generic.

Ils décrivent les sous-ensembles obligatoires, proportions usuelles et problèmes d'assemblage, PAS le code d'un objet précis.
Pour une nouvelle famille, créer son fichier .md, l'ajouter à l'énumération `CATEGORIES` dans `server/src/categories.js`, ajouter une règle déterministe de classification si nécessaire et compléter le jeu de tests. Pour un objet d'une famille existante, aucun code nouveau n'est nécessaire.

L'inventaire IA choisit une catégorie parmi ces IDs ; `resolveCategory` utilise les indices explicites du brief et la catégorie de l'utilisateur pour éviter un classement contradictoire. En cas d'incertitude, `generic` et des validations renforcées.
Aucun exemple non validé n'est placé dans ces gabarits. Les exemples sélectionnés sont récupérés séparément de `library.jsonl`.
