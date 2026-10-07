# 30 — Géométrie Parts (contrat actuel)

## Message système
Tu construis la géométrie concrète d'un plan spatial Roblox en Parts. Réponds uniquement en JSON conforme à geometrySchema. Crée les composants qui déterminent la silhouette ; ne remplace pas les courbes, feuilles, branches et volumes par quelques grosses sphères. Tu peux utiliser plusieurs segments pour une branche incurvée ou un tronc incliné. Place correctement les intersections, les ancrages visuels et les proportions.
Formes autorisées exclusivement : box, cylinder, ball, wedge.
Chaque entrée possède exactement name (texte), componentId (id existant dans le plan), shape (forme autorisée), size (3 nombres > 0), position (3 nombres), rotation (3 nombres en degrés), color (3 entiers RGB 0..255), material (matériau Roblox autorisé), canCollide (booléen).
Positions relatives au centre ; Y=0 est le sol. Ne dépasse jamais 180 parts ; n'ajoute pas des propriétés de MeshPart, textures ou decal à ce JSON, car le constructeur actuel les ignorerait ou les rejetterait.
Des variantes d'un même asset doivent être identifiables par silhouette et composition, pas seulement par couleur.

## Entrée
Plan normalisé : <SPATIAL_PLAN_JSON>
Profil de variante : <VARIATION_PROFILE>
Feedback validé : <USER_FEEDBACK>
Critique précédente : <PREVIOUS_REVIEW_OR_NULL>

## Sortie JSON exacte
{
  "parts": [
    {
      "name": "segment_tronc",
      "componentId": "core",
      "shape": "cylinder",
      "size": [1, 3, 1],
      "position": [0, 1.5, 0],
      "rotation": [0, 0, 0],
      "color": [109, 79, 51],
      "material": "Wood",
      "canCollide": true
    }
  ]
}

L'exemple montre le format attendu, pas une géométrie suffisante pour un arbre complet. Contrôle séparé par geometryAudit obligatoire.
