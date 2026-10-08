# 30 — Géométrie paramétrique (mode Parts, contrat compatible)
Le modèle local choisit d'abord un archétype et quelques paramètres. Il ne calcule plus les positions/rotations de chaque pièce : le constructeur déterministe de server/src/archetypes/ le fait.
Répondre en JSON. Archétypes disponibles : palmTree, broadleaf, rock, house.
```json
{"archetype":"palmTree","params":{"height":0.86,"curvature":0.18,"baseRadius":0.065,"frondCount":10,"frondLength":0.43,"segments":6,"trunkColor":[112,79,51],"leafColor":[59,147,74],"coconutColor":[107,73,42],"material":"Wood"},"variation":"silhouette"}
```
Valeurs dimensionnelles relatives à `sizeStuds`. Le modèle ajuste les paramètres à l'objet et au brief. Le profil de variation défini par le job a priorité et impose des différences de géométrie visibles.
Les schémas sont exportés par chaque module sous `{id,schema,build}` ; `geometrySchema` admet l'enveloppe paramétrique, avec `archetype` en enum.
Le résultat de `build(params)` utilise exactement l'ancien tableau `parts` (name, componentId, shape, size, position, rotation, color, material, canCollide) pour rester utilisable par `buildPartsVariant`.
Si aucun archétype ne correspond, le contrat Parts libre historique reste disponible :
```json
{"parts":[{"name":"component","componentId":"core","shape":"box","size":[1,2,1],"position":[0,1,0],"rotation":[0,0,0],"color":[100,140,80],"material":"SmoothPlastic","canCollide":true}]}
```
Ne pas copier de bibliothèque propriétaire. Les courbes Bézier et primitives géométriques sont implémentées indépendamment à partir de mathématiques usuelles.
