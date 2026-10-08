# Corrections par patch

Une correction conserve la variante source et crée une nouvelle variante. Les formats Parts patchables sont les paramètres d'un archétype, les primitives normalisées et les Parts historiques. Une génération native Roblox reçoit une nouvelle consigne et doit être vérifiée par comparaison des captures. Les anciens jobs restent lisibles ; les identifiants manquants et les paramètres implicites sont ajoutés à leur définition lors de la première correction, sans modifier leur géométrie source.
Un patch exige le même `planVersion` que le plan courant du job ; une variante d'un plan plus ancien propose « Rebuild » dans l'interface, afin de ne pas appliquer ses identifiants de composants à un plan différent.
Un rebuild conserve temporairement l'ancien plan. Si la nouvelle planification échoue, l'ancien plan est restauré afin de permettre un autre patch ; pour les jobs déjà affectés, le serveur peut relire le plan versionné dans les traces. Une planification locale tronquée augmente sa limite de sortie au second essai, et les appels structurés de géométrie et correction désactivent le raisonnement du modèle local.
Le schéma des primitives passe à `1.1.0` avec un champ `id` facultatif ; l'interpréteur accepte les définitions `1.0.0` et attribue les identifiants manquants avant un patch. Les champs de correction ajoutés aux jobs restent facultatifs pour les jobs historiques.

## Contrat du patch

Le modèle répond soit `{ "target": "params|parts", "ops": [{ "op": "set|scale|add|remove", "path": "...", "value": ... }], "reason": "..." }`, soit `{ "target": null, "unsupported": "raison" }`. Pour `params`, le chemin est un nom déclaré dans le schéma de l'archétype ; `set`, `scale` et `add` numérique sont permis. Pour `parts`, le chemin est `componentId.primitiveId.champ`, ou `componentId.primitiveId.champ.index` pour une coordonnée. `componentId.$new` ajoute une primitive complète et `componentId.primitiveId` la retire. Le serveur attribue les identifiants des primitives ; les chemins et valeurs hors schéma sont refusés et tracés. Les nombres sont bornés par le schéma.

`definitionFingerprint` utilise SHA-256, clés triées et quatre décimales ; `geometryFingerprint` compare les Parts avec trois décimales. Une correction Parts est `changed` si les deux empreintes changent et si des captures correspondantes diffèrent. Une revue visuelle locale répond à la question exacte du retour, indépendamment de la note globale. `resolved` exige `changed` et une réponse `resolved: true`. Sans changement vérifié : `no_effect` ; avec changement mais sans confirmation : `unresolved`. Un retour impossible à traduire : `unsupported`. Seul `resolved` peut être validé par l'utilisateur.

## Historique et réutilisation

`data/runtime/generations.jsonl` contient la définition, les empreintes, le moteur et la version du schéma par variante ; `feedback.jsonl` contient le retour brut et son type ; `corrections.jsonl` contient une ligne `attempt` par tentative, puis des lignes `validation` liées à son identifiant. `requests.jsonl` enregistre les retours `unsupported`. Les captures dédupliquées sont dans `data/runtime/captures/<sha256>.<extension>`. Les écritures JSONL sont sérialisées, réalisées dans un fichier temporaire puis renommées. Ces fichiers runtime sont exclus de Git.

Les exemples de patch sont recherchés par type de retour ; seuls ceux au statut `resolved` avec validation humaine explicite sont proposés, au maximum trois. Une correction `no_effect` ou `unsupported` reste visible mais ne peut être classée ou sauvegardée. Une correction non validée peut être sauvegardée comme asset si elle a changé, mais ne nourrit pas les exemples ni les leçons.

Pour ajouter un paramètre d'archétype : déclarer ses bornes dans le schéma, sa valeur historique dans `defaults`, l'utiliser dans `build()` et déclarer son rôle dans `review/paramRoles.json`. Ajouter un test comparant `build({})` et `build(defaults)` avant de proposer le paramètre au modèle.
