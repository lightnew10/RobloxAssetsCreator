# Audit des corrections et de la génération — 9 octobre 2026

Statut : diagnostic du code et des historiques locaux, avec propositions. Aucun correctif runtime livré pendant cet audit. Aucun nouvel appel IA ni construction Studio exécuté. Les captures examinées sont historiques.

## Conclusion

Le cas « élargir les palmes du cocotier » révèle une correction exécutée mais trop faible visuellement, puis une reconstruction interrompue par une sortie JSON tronquée. Ce cas ne démontre pas une perte du texte utilisateur : le texte est présent dans les historiques et dans le patch proposé. D'autres parcours peuvent toutefois perdre l'intention ou revenir à une géométrie par défaut.

AGENTS.md est cohérent sur la préservation des sources, les statuts de correction et la validation humaine. Il décrit les règles de développement ; il n'est pas envoyé au modèle local. Les prompts actifs sont dans `server/src/prompts.js`. Renforcer AGENTS.md seul ne changera donc pas les corrections IA.

## Preuves du cocotier

Job `2634dabc-b00c-485b-b63a-1f2e01134f61`, source `027c46d9-1727-4b42-a69b-a71361a5ffc3`, patch `2a51257b-2f87-4cf3-b871-414daf0a7ee6`.

- Retour journalisé : « too_thin · palmes / feuillages trop fin ».
- Paramètre `frondWidth` : 0,105 → 0,125, soit +19,05 %.
- Comparaison des Parts sauvegardées : 60 segments de palmes avant et après ; largeur maximale 0,5070 → 0,6036 stud. Les tailles, positions, rotations, couleurs, matériaux et collisions des Parts autres que les palmes sont identiques. Le seed source et le seed du patch sont identiques.
- Revue ciblée : `resolved: false`, feuillage encore trop fin ; statut `unresolved`. Le système n'a pas déclaré cette correction résolue.
- Examen direct de la première vue avant/après : asset petit dans l'image, feuillage toujours étroit. Un changement numérique ne suffit pas à prouver une amélioration esthétique.
- Rebuild suivant : `AI_INVALID_JSON`, `doneReason: length`. L'ancien plan existe dans le snapshot actuel de ce job.
- Dans un autre job, `d7f4e7ce-5226-44de-b089-6cd4784e0c40`, un ancien rebuild avait laissé le plan absent ; le patch suivant échouait avec `Cannot read properties of null (reading 'components')`. Le code actuel contient récupération du plan et restauration après échec ; leur présence et les tests ne prouvent pas la reprise réelle de ce job dans Studio.

Sources locales : jobs cités, `data/runtime/feedback.jsonl`, `data/runtime/corrections.jsonl`, captures et FULL TRACE correspondants. Ces fichiers restent locaux et exclus de Git ; aucune image privée n'a été envoyée lors des recherches web.

## Parcours et limites constatés

| Étape | Fonctionnement actuel | Limite |
| --- | --- | --- |
| Commentaire avec note /10 | `App.jsx` → `/rating` → `humanRatingHistory` | Ce commentaire ne devient pas une demande de correction. Patch/Rebuild utilisent le champ distinct `feedback`. |
| Demande explicite | `/correct` → `requestCorrection` → `feedback` et `pendingCorrection` | Texte libre limité à 1000 caractères ; les cases à cocher sont concaténées au texte. |
| Patch Parts | `preparePatch` → `patchUser` → opérations validées | Le proposeur reçoit la définition et le retour, sans captures, sans brief complet ni contrat détaillé des champs disponibles. |
| Application | `applyPatch` → reconstruction déterministe | Le composant demandé est une indication au modèle ; aucun contrôle ne garantit à cette étape que toutes les opérations restent dans ce composant. |
| Contrôle | Empreintes, captures avant/après, revue ciblée | Un hash d'image différent prouve des pixels différents, pas une meilleure silhouette. Le contrôle ciblé est utile mais dépend de la lisibilité des vues. |
| Résultat insuffisant | Statut `unresolved` conservé | La demande humaine ne déclenche pas de nouvelle tentative dédiée pour augmenter progressivement l'effet. Les reprises techniques ne constituent pas cette boucle. |
| Rebuild | Nouveau plan et nouvelles variantes ; feedback transmis | Le modèle reçoit l'historique global des feedbacks, sans séparation explicite des consignes actives, remplacées et propres à une autre variante. Il ne reçoit pas la définition source comme ancrage du nouveau plan. |
| Repli géométrique | Archétype déterministe avec `params: {}` après échecs IA | Le repli utilise les défauts. Il ne traduit pas les notes en paramètres ; une reconstruction peut donc revenir aux anciennes proportions malgré le feedback. Ce mécanisme est présent, sans preuve qu'il a été atteint dans le rebuild tronqué cité. |

Le paramètre du cocotier est une fraction de la longueur de chaque palme dans `palmTree.js`, pas une largeur absolue en studs. Le constructeur utilise des wedges segmentés ; il peut élargir la lame actuelle mais ne crée pas automatiquement des folioles ou une nouvelle topologie de feuille. La géométrie limite donc aussi les demandes que le modèle peut satisfaire.

## Bug additionnel reproduit

Dans `server/src/change/patch.js`, le format Parts historique construit `entries` avec `next.parts.filter(...)`. `entries.push(candidate)` ajoute la nouvelle Part au tableau filtré, sans l'ajouter à `next.parts`. Une reproduction en mémoire donne une opération annoncée appliquée et une définition toujours composée d'une seule Part. Le contrôle d'empreintes peut ensuite reconnaître l'absence d'effet ; l'application elle-même doit être corrigée. Ce bug n'explique pas le patch paramétrique du cocotier.

## Réglages observés

`server/.env` configure `qwen3:8b` pour le texte, `qwen3-vl:4b-instruct` pour la vision, un contexte de 8192 et `OLLAMA_PLANNING_THINK=false`. Les budgets sont 1500 tokens pour le plan, 650 pour la géométrie, 900 pour la revue. Les défauts actuels du code sont plus élevés pour plan/géométrie : 3000/2000. Les valeurs du fichier prennent la priorité. La planification tronquée dispose déjà d'une augmentation bornée au retry dans le code ; augmenter les budgets seul ne garantit pas la qualité ou la conformité du JSON.

## Solution recommandée, progressive

### 1. Correction explicite et déterministe

Créer un contrat d'intention distinct des opérations bas niveau : cible, propriété visuelle, direction, quantité éventuelle, éléments à préserver, critère de réussite. L'IA locale interprète la phrase ; le serveur compile les changements connus en opérations autorisées. Ne pas ajouter ces champs aux schémas existants sans versionnement et tests de compatibilité.

Exemple : « élargis les palmes » → cible feuillage, propriété largeur, direction augmenter, préserver tronc/noix/nombre/longueur/courbure. Si aucune quantité n'est indiquée, une intensité par défaut clairement visible peut fournir un premier essai ; sa valeur reste à calibrer avec l'utilisateur. Une demande précise « +50 % » doit donner un ratio vérifié, sous réserve des bornes annoncées.

Pour le cocotier, une expérience +50 % ferait passer `frondWidth` de 0,105 à 0,1575. C'est une proposition de test, pas une largeur validée. Ne pas modifier le défaut global de tous les cocotiers pour résoudre un retour propre à une variante.

Afficher avant/après en langage utilisateur : « largeur des palmes +50 %, tronc et noix conservés ». Présenter les champs JSON dans les détails techniques. Proposer une action explicite « Appliquer ce commentaire » depuis la note /10 ; conserver la possibilité de laisser un commentaire d'évaluation sans le transformer en ordre.

Fournir au proposeur les chemins réellement autorisés, les valeurs courantes, les unités et bornes, un contexte source ciblé et, si nécessaire, une observation visuelle locale. Appliquer côté serveur la portée demandée et les invariants.

### 2. Boucle courte guidée par le résultat

Construire la correction depuis la source sélectionnée, avec mêmes seed/profil. Vérifier le changement géométrique attendu et l'intégrité des composants préservés avant Studio. Capturer une vue générale et des vues rapprochées de la cible avec cadrage comparable. La revue pose la question exacte du retour, indépendamment de la note globale.

Si le changement existe mais reste insuffisant : une seconde tentative bornée ajuste son amplitude, avec conservation de chaque version. Respecter le budget total et arrêter sur stagnation, borne atteinte ou demande nécessitant une autre représentation. Afficher séparément « appliqué », « visuellement confirmé », « restant » ; ne jamais convertir `unresolved` en succès.

### 3. Reconstruction ancrée et sorties compactes

Réserver la reconstruction aux changements structurels ou de représentation. Injecter la demande active, la source et les consignes de conservation ; exclure les anciens retours remplacés ou propres aux autres branches. Garder le nouveau plan temporaire jusqu'à validation, comme l'exige AGENTS.md.

Pour les modèles locaux : prompts spécialisés, exemples compacts conformes au schéma exact et budget adapté par étape. Ajouter un message clair lorsqu'un repli déterministe conserve seulement la catégorie mais ne peut pas satisfaire la correction. Ne pas livrer ce repli comme une correction réussie.

### 4. Améliorer la représentation après la correction

Garder Parts pour structures simples et collisions. Tester des palmes procédurales à surface plus lisible ; si les wedges restent insuffisants, expérimenter des MeshParts locaux avec un contrat propre. Comparer la silhouette et les performances avant de généraliser.

## Comparaison avec des systèmes documentés

- **Roblox ProceduralModel** : structure définie par un générateur et attributs qui déclenchent une régénération non destructive. Principe pertinent : exposer des paramètres sémantiques stables et modifiables. Il ne faut pas confondre le constructeur JavaScript actuel avec un ProceduralModel natif. [Documentation officielle](https://create.roblox.com/docs/parts/procedural-models).
- **Roblox Assistant / segmentation** : composants distincts pour personnaliser ou remplacer certaines parties sans régénérer tout le modèle. Principe pertinent : cibler réellement feuillage/tronc/fruits. Les services de génération natifs Roblox sont une voie distincte des IA locales et ne doivent pas être activés automatiquement. [Documentation officielle](https://create.roblox.com/docs/assistant/guide).
- **Ollama Structured Outputs** : schéma JSON dans `format`, schéma aussi décrit dans le prompt, validation et température basse ; vision structurée disponible. Le projet utilise déjà `format: schema` et Ajv. Le gain proposé porte surtout sur la précision du contrat et du contexte, pas l'ajout d'un mécanisme déjà présent. [Documentation officielle](https://docs.ollama.com/capabilities/structured-outputs).
- **TRELLIS.2** : voie image vers mesh texturé locale à expérimenter pour certaines formes complexes. Le dépôt officiel annonce Linux uniquement pour les tests et un GPU NVIDIA d'au moins 24 Go. Aucune compatibilité Windows, qualité des palmes ou vitesse sur ce PC n'a été validée. [Dépôt Microsoft](https://github.com/microsoft/TRELLIS.2).
- **Hunyuan3D-2** : génération de forme et texture, application/API et intégration Blender documentées. Candidat à comparer sur les mêmes références après vérification du matériel, des licences, de la simplification et de l'import Studio. Il ne remplace pas directement une correction paramétrique ciblée. [Dépôt officiel Tencent](https://github.com/Tencent-Hunyuan/Hunyuan3D-2).

Ces pistes sont des propositions issues des capacités documentées, pas des intégrations réalisées. Aucun téléchargement ou envoi de références à ces services pendant l'audit.

## Validation à prévoir pour une implémentation

1. Phrase précise « élargir toutes les palmes de 50 % » : variation mesurée, bornes explicites, invariants tronc/noix vérifiés, source intacte.
2. Phrase qualitative « encore trop fines » : essai supplémentaire borné ou explication de la limite ; aucune nouvelle tentative identique sans motif.
3. Format historique : ajout réellement présent, composant ciblé respecté, champs invalides refusés.
4. Commentaire /10 conservé ; transfert volontaire vers la correction visible et testé.
5. Rebuild tronqué : ancien plan utilisable et aucune correction faussement terminée.
6. Retours contradictoires sur deux variantes : seules les consignes actives de la branche s'appliquent.
7. Studio : captures fixes avant/après et rapprochées ; choix humain. Comparer aussi feuillu, rocher et maison pour vérifier la généralité.

## Vérifications exécutées pendant l'audit

- `npm test` : **109 tests réussis**.
- `npm run build` : **réussi hors sandbox** ; première tentative bloquée par Windows `EPERM realpath` dans le sandbox.
- Comparaison des Parts historiques du cocotier et reproduction en mémoire du bug d'ajout historique.
- Examen visuel de deux captures historiques avant/après.
- `npm run verify` complet non exécuté ; évaluation fixtures et export dataset non relancés. Aucun fichier utilisateur runtime/export réécrit pour cet audit.
- Aucune nouvelle génération, revue IA, mesure VRAM ou validation interactive Studio. Les tests existants vérifient des contrats et transformations, pas que le modèle comprend une phrase libre ou satisfait visuellement l'utilisateur.
