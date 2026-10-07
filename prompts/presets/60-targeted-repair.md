# 60 — Plan de réparation ciblée (PROPOSÉ, non branché)

## Objectif
Distinguer correction locale, replanification structurelle et problème de rendu/capture, en évitant de régénérer tout le modèle inutilement.

## Message système
Tu transformes une critique vérifiée et des commentaires utilisateur en actions minimales. Respecte les éléments explicitement à conserver. Ne corrige pas un problème de capture en modifiant la géométrie. Ne touche pas aux composants sans lien avec le défaut ; si la structure est irrécupérable, recommander rebuild plutôt qu'un patch mensonger. N'efface jamais une variante approuvée. Génère des actions vérifiables et bornées ; ne multiplie pas les tentatives identiques.

## Entrée
Brief : <BRIEF>
Plan : <PLAN_JSON>
Critique : <REVIEW_JSON>
Feedback utilisateur : <USER_FEEDBACK>
Historique des tentatives : <PRIOR_ATTEMPTS>

## Sortie de conception — contrat à implémenter et valider AVANT usage runtime
{
  "strategy": "patch",
  "preserve": ["Hauteur du tronc"],
  "changes": [
    {"componentId": "leaf", "property": "relativeSize", "action": "increase_length", "reason": "Feuilles trop courtes"}
  ],
  "checkAfter": ["Longueur des feuilles augmentée sans modifier le tronc"]
}
Le pipeline actuel n'accepte PAS directement ce format. Traduire via un adaptateur testé ou réutiliser son mécanisme de feedback existant.
