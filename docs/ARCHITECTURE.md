# Architecture Asset 3D

## Pipeline principal

1. **Entrée**
   - nom, catégorie, sous-type, style, brief ;
   - 0 à 4 images de référence ;
   - provider texte + provider vision ;
   - moteur Auto / Parts / Roblox natif.

2. **Understanding**
   - les références visuelles sont analysées ;
   - silhouette, structure, couleurs et détails à préserver deviennent du contexte de planification.

3. **Plan 3D**
   - JSON structuré ;
   - dimensions en studs ;
   - composants et relations parent/enfant ;
   - critères essentiels ;
   - vues de capture ;
   - méthode native suggérée.

4. **Réparation structurelle**
   - normalisation des IDs ;
   - résolution par id/nom/rôle ;
   - détection `missing_parent`, `self_parent`, ambiguïtés et cycles ;
   - nouvelle planification ciblée si la réparation déterministe ne suffit pas ;
   - circuit breaker après trois erreurs identiques.

5. **Variantes**
   - 3 variantes par défaut ;
   - profils réellement différents : équilibrée, silhouette, détaillée ;
   - jusqu'à 6 variantes configurables.

6. **Construction**
   - **Parts** : l'IA produit la géométrie exacte ; audit avant Studio ; fallback déterministe segmenté ;
   - **Native** : `generate_mesh` ou `generate_procedural_model` puis `wait_job_finished` ;
   - **Auto** : natif si disponible, sinon Parts.

7. **Audit Studio**
   - modèle présent ;
   - nombre de BaseParts ;
   - ancrage ;
   - bounds ;
   - matériaux.

8. **Captures**
   - trois vues ;
   - retries ;
   - fichiers persistés dans `data/runtime/captures`.

9. **Critique visuelle**
   - score 0-10 ;
   - critères essentiels ;
   - décision accept / patch / rebuild ;
   - problèmes par composant.

10. **Review utilisateur**
    - sélection ;
    - patch ciblé ;
    - rebuild complet du plan ;
    - sauvegarde explicite dans `ServerStorage/RobloxAssetsCreator_Assets`.

11. **Learning**
    - aucun feedback brut n'est promu automatiquement ;
    - les leçons deviennent réutilisables uniquement après sélection humaine d'une variante ;
    - les futures créations similaires réutilisent les leçons validées par catégorie/sous-type.

12. **FULL TRACE**
    - requêtes/réponses IA ;
    - plans ;
    - appels MCP ;
    - captures ;
    - incidents ;
    - apprentissage ;
    - clés et secrets redacted.

## Récupération des erreurs

Une signature est construite avec stage + code + cause + variante.

- erreur #1 identique : retry / réparation déterministe ;
- erreur #2 identique : stratégie alternative ou replan ciblé ;
- erreur #3 identique : stop du job + alerte Telegram si configurée.

L'objectif est de ne plus laisser une erreur `missing_parent` ou MCP faire échouer silencieusement toute une création.
