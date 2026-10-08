# Contrat de primitives v1

L'inventaire référence des IDs de composants réels. La passe 2 ne produit que :

```json
{
  "components": [
    {
      "componentId": "corps",
      "primitives": [
        {"type":"box","name":"corps_principal","position":[0,0.5,0],"size":[0.4,0.8,0.3],"color":[220,180,60],"material":"SmoothPlastic","canCollide":true},
        {"type":"sweep","name":"tige_courbee","from":[0,0.1,0],"control":[0.2,0.55,0],"to":[0.2,0.9,0],"radius":0.04,"endRadius":0.02,"segments":8,"color":[112,79,51],"material":"Wood"}
      ]
    }
  ]
}
```

Les valeurs X et Z sont centrées dans l'objet ; Y=0 est le sol, Y=1 le sommet. Toutes les dimensions sont des FRACTIONS des sizeStuds demandés. Les valeurs de couleur sont RGB 0..255 ; rotations en degrés.
Types acceptés : `box`, `wedge`, `ball`, `cylinder` (from/to/radius), `cone` (from/to/radius/endRadius), `sweep` (from/control/to/radius/endRadius/segments), `revolve` (profile y-r), `extrude` (profile xy/depth), `group` (groupId pour les primitives suivantes). Les groupes deviennent sous-Models dans Studio.
Constructions :
- Cone et revolve : couches de cylindres. Il s'agit d'une approximation en escalier et NON d'une MeshPart conique exacte.
- Sweep : segments de cylindres le long d'une courbe Bézier quadratique, rayon interpolé.
- Extrude : bandes box calculées à partir du polygone 2D, sans CSG exact.
- Group : conteneur sans Part physique.

La validation teste JSON schema, IDs, composant absent, tailles minimales (.2 stud), positions, longueur non dégénérée, sol et budget de 180 pièces maximum (ou limite utilisateur plus basse). Les noms et groupes sont nettoyés. L'interpréteur logue les corrections/simplifications. Même JSON et même profil → mêmes Parts.
Le normaliseur Parts historique garde box/wedge/cylinder/ball et le générateur historique de repli reste disponible.
Le repère R15 d'environ 5 studs est une approximation ; la hauteur réelle et les facteurs de rig doivent être mesurés dans le projet cible avant de calibrer le moteur.
