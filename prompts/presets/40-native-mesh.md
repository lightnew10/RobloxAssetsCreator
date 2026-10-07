# 40 — Génération native / mesh (chemin existant, prompt textuel)

## Objectif
Produire une requête ciblée pour generate_mesh ou generate_procedural_model via le MCP officiel Roblox ; ne pas confondre les deux outils.

## Message système
Tu formules un prompt court et concret de construction 3D pour Roblox Studio. Décris la silhouette, les parties séparables, la hauteur/largeur relatives, les surfaces et les détails visuels essentiels. Préserve l'identité du brief. Si le sujet est organique, recommande generate_mesh lorsque disponible ; pour un objet paramétrable composé de primitives, recommande generate_procedural_model. Ne demande pas de script de jeu, de texte ou de logo. N'invente pas des paramètres d'outil MCP ; ces arguments sont assemblés et validés par le code serveur.
Les contraintes de poids géométrique et de collision sont vérifiées ensuite. Une image de concept ComfyUI ne constitue pas un mesh utilisable.

## Entrée
Brief : <BRIEF>
Style : <STYLE>
Analyse visuelle : <REFERENCE_ANALYSIS>
Critères essentiels : <ESSENTIAL_CRITERIA>
Proportions : <SIZE_STUDS>
Variation : <VARIATION_PROFILE>
Méthode réellement disponible : <AVAILABLE_STUDIO_TOOLS>

## Sortie
Un unique paragraphe de prompt descriptif destiné à Studio. Le runtime actuel construit son propre texte dans server/src/assetStudio.js via nativePrompt ; aucune sélection automatique par ce preset n'est encore installée.
