# ComfyUI Desktop et textures — proposition d'intégration

Statut : conception, aucune connexion ComfyUI opérationnelle affirmée.

## Objectifs raisonnables
1. Produire des images de référence plus lisibles (silhouette/vue/forme) pour aider l'analyse vision et la génération 3D.
2. Générer des textures seamless répétables pour des surfaces de Parts, après vérification du tiling.
3. Générer des decals précis pour des détails de surface.
4. Générer, si UV disponibles, des images albedo pour MeshPart / SurfaceAppearance.
Les images ne deviennent pas automatiquement des modèles 3D. PBR normal/roughness/metalness demande un workflow adapté et une validation visuelle/technique, pas simplement un prompt d'image couleur.

## Intégration future optionnelle
- Détecter l'adresse de l'instance ComfyUI Desktop sur la machine, sans supposer un port fixe.
- Vérifier la disponibilité de l'API et la version installée. Charger un workflow exporté en format API, fourni/validé pour les modèles et nodes effectivement présents.
- Fournir inputs explicites (prompt, seed, résolution, références) et gestion du cycle de job, erreurs, délais et annulation.
- Récupérer images + métadonnées ; protéger les fichiers locaux ; enregistrer dans FULL TRACE des chemins sûrs et les paramètres non secrets.
- Soumettre images à une vérification de répétabilité, de transparence et d'absence d'artefacts ; permettre au créateur de choisir.
- Prévoir une phase d'import Roblox vérifiée, avec approbation si nécessaire : image locale != ID d'asset Roblox utilisable par un Decal ou SurfaceAppearance.
- Si ComfyUI est indisponible, conserver complètement le pipeline actuel, sans bloquer le job.

## Utilisation Roblox : ne pas confondre
- Part + Decal : une face, image étirée ; Part + Texture : motif répété sur la face.
- MeshPart + SurfaceAppearance : textures PBR et UV compatibles, image asset et propriétés appropriées.
- Matériaux natifs Roblox ou MaterialVariant selon le besoin.
- Les textures améliorent les détails de surface ; elles ne corrigent pas une silhouette incorrecte.
- Optimiser la résolution pour le type d'asset ; examiner le coût mémoire, la distance d'affichage et les capacités de l'appareil.

## Sécurité et droits
Liaison locale seulement par défaut ; ne pas exposer ComfyUI sur Internet automatiquement. Aucun appel à un nœud API cloud payant sans information et permission de l'utilisateur. Aucune clé ni image privée publiée dans les traces ou le dépôt. Respecter les droits sur les images d'entrée et la modération Roblox.

## Validation minimale avant d'intégrer au pipeline
A. Image concept : une référence qui aide le planner à distinguer la silhouette.
B. Écorce : texture répétable, sans raccords visibles, test sur cylindre.
C. Decal : détail appliqué sur une face, sans mauvaise mise à l'échelle.
D. Mesh avec UV : albedo correctement aligné, test de SurfaceAppearance.
E. Arrêt ComfyUI : le pipeline d'assets continue sans génération d'images.

## Références
- https://docs.comfy.org/
- https://create.roblox.com/docs/parts/textures-decals
- https://create.roblox.com/docs/art/modeling/surface-appearance
- https://create.roblox.com/docs/art/modeling/texture-specifications
