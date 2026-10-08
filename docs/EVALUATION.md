# Évaluation et non-régression

`data/eval/objects.json` regroupe 28 briefs d'objets : petit objet, véhicule, bâtiment, végétal, animal, mobilier, infrastructure, générique.
`npm run eval:fixtures` vérifie localement classification, taille d'entrée et disponibilité du gabarit. Le rapport est écrit dans `data/runtime/evaluation.json`. Cette évaluation est incluse dans `npm run verify`.

IMPORTANT : ce test ne mesure PAS la ressemblance visuelle et ne fait PAS appel à Studio ou Ollama. Il ne doit pas être présenté comme une amélioration de rendu. Les scores visuels sont initialement `not_measured`.
Pour l'évaluation visuelle : garder la même version de Studio, des modèles Ollama, des seeds et des briefs ; faire les captures face/profil/dessus, les comparer à une référence avec une critique IA locale et une notation humaine. L'acceptation d'une version exige une amélioration moyenne et aucune dégradation >2 points sur un objet de référence.
La comparaison couleur PNG existante est un diagnostic expérimental, pas une métrique CLIP ni une validation de qualité. Les modèles tiers ne sont pas requis.
Un benchmark du planificateur en deux étapes et du modèle en une étape est disponible via `npm run benchmark:planning` ; il n'est pas automatiquement intégré au résultat de qualité visuelle.
