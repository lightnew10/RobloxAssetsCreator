# Questions avant une correction humaine

Implémenté le 9 octobre 2026. Cette étape clarifie les demandes humaines Patch et Rebuild ; elle ne modifie pas la création initiale ni les corrections automatiques.

## Parcours

Le provider texte du job analyse brièvement la demande et la variante source. Il retourne zéro question si la demande est précise, sinon de une à trois questions en français. Pendant l'analyse : `clarifying_correction`. Si des réponses sont nécessaires : `awaiting_correction_answers`, avant toute nouvelle construction de correction. Les lots en série traitent cette attente avant la correction et avant le lot suivant. Le job libère la file de travail pendant l'attente humaine.

La fenêtre « L’IA attend ta réponse » affiche Question N sur M, suggestions et réponse libre. Les mesures proviennent des bounds Studio de la variante sélectionnée ; pour les cocotiers paramétriques, la largeur maximale des segments de palmes vient des tailles locales des Parts. Ce n'est pas l'envergure de la couronne. Les valeurs sont affichées arrondies à trois décimales. Si aucune mesure fiable n'est disponible, aucune dimension n'est inventée. Les paramètres sans unité restent distincts des studs ; le patch reçoit les mesures, les bornes et une description de l'unité de `frondWidth`.

Fermer la fenêtre ou avancer enregistre le brouillon sur le serveur. Les saisies non enregistrées ne sont pas garanties après un rechargement brutal. Les questions indispensables exigent une réponse ; « Laisser l’IA choisir » est disponible seulement pour les préférences facultatives. Le nombre de questions reste fixe après leur production : aucun nouvel interrogatoire automatique après les réponses.

La soumission transmet les questions/réponses exactes au texte actif du feedback : plan, géométrie, patch, génération native et revue ciblée utilisent ce contexte. L'annulation conserve la source, archive les questions et marque le feedback annulé pour l'exclure des futurs prompts. Elle rend le job à la revue, y compris en mode série, sans lancer le lot suivant.

Une panne d'analyse pose une question explicite de secours sans exécuter silencieusement une demande ambiguë. Le prompt n'exige pas d'images ni de service supplémentaire ; les jobs locaux interrogent Ollama local. Un provider externe explicitement choisi sur un job reste le provider de ce job.

## Contrat et compatibilité

- Module : `server/src/change/clarification.js`, prompt actif et schéma de sortie exact.
- `pendingCorrection.clarification` : schéma version 1, état `waiting|ready|answered|cancelled`, questions avec ids `q1..q3`, réponses, mesures et diagnostic éventuel.
- Les clarifications annulées restent dans `correctionClarifications`. Les réponses soumises restent avec le feedback et les variantes de correction ; elles ne deviennent pas des exemples sans la validation existante.
- API : `POST /api/jobs/:jobId/corrections/:correctionId/answers`, `{action:"draft|submit|cancel",answers:{q1:"..."}}`.
- Identifiant périmé, réponse inconnue, réponse de plus de 1000 caractères et réponse indispensable manquante sont refusés avant la mutation.
- Définitions géométriques, schémas de plan et limites existantes inchangés. Champs et statuts ajoutés ; aucun fichier historique réécrit au démarrage. Les jobs sans demande en attente gardent leur parcours. Une ancienne demande encore en attente passe par la clarification à sa reprise.
- Après redémarrage, les questions déjà produites restent disponibles. Une analyse interrompue passe par la reprise habituelle. Reprendre un job arrêté avec questions conserve l'attente au lieu de contourner les réponses.
- Les presets documentaires restent non branchés. Aucun nouveau contrat n'est injecté dans leurs schémas de géométrie.

## Vérifications du 9 octobre 2026

- Tests automatisés : mesures réelles, limites de schéma, brouillons, soumission obligatoire/facultative, propagation patch/rebuild, annulation, ids périmés, échec IA, sauvegarde/rechargement et absence de deuxième appel pendant l'attente.
- `npm run verify` : tests serveur, compilation web, 28 fixtures statiques et export du dataset validé.
- Navigateur, données fictives isolées : passage 1/2 → 2/2, réponse indispensable bloquante, choix +50 %, fermeture/réouverture, réponses conservées après rechargement et passage à `queued` après soumission. Aucun job utilisateur ni Studio utilisé pour cet aperçu.
- Ollama local `qwen3:8b`, deux phrases fictives : « Élargis les palmes du cocotier » → une question sur la largeur cible (environ 3,9 s) ; demande explicite +50 % avec invariants → zéro question (environ 3,1 s). Mesure ponctuelle, pas un benchmark.
- La pertinence de toutes les questions et la fidélité de la correction finale restent à vérifier dans Studio. Cette étape transmet les réponses ; elle ne garantit pas à elle seule que le moteur géométrique peut satisfaire une nouvelle forme.

## Test manuel Studio

1. Redémarrer le serveur et ouvrir une variante terminée de cocotier.
2. Demander « Élargis les palmes » avec Patch : vérifier attente, source intacte, mesure actuelle et question de quantité.
3. Répondre +50 %, conserver longueur/tronc/noix, puis appliquer. Vérifier FULL TRACE, opérations, largeur réelle et captures ; conserver les statuts `unresolved` ou `no_effect` si nécessaire.
4. Répéter avec Rebuild ; vérifier que les réponses sont dans le feedback de planification et que le plan précédent reste disponible si la reconstruction échoue.
5. Tester fermeture, redémarrage du serveur, réouverture, annulation et demande déjà précise. En série, aucun lot suivant pendant les questions ; l'annulation revient à la revue.
