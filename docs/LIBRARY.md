# Bibliothèque d'apprentissage local

Chemin : `data/runtime/library.jsonl`. Chaque ligne est un exemple **choisi par l'utilisateur et noté au moins 8/10 par lui**, pas une note de l'IA.
Champs : version, sourceJobId, sourceVariantId, humanValidated, validationSource, humanRating, brief, name, language (indicatif), keywords, category, subtype, visualAnalysis, referencePaths (chemins locaux), inventory, decomposition, schemaVersion, interpreterVersion, engineUsed, aiReview, feedback, correctionOf et date.

- Les photos restent sur le PC : `data/runtime/library_refs/` ; le JSON ne contient que des chemins locaux.
- Un résultat natif de Roblox n'est pas promu comme exemple pour entraîner notre IA, faute d'autorisation explicite.
- Les corrections humaines acceptées peuvent être stockées en tant que versions distinctes.
- Déduplication par job+variante ; sélection des exemples d'abord par catégorie, puis sous-type et similarité de mots-clés. Maximum trois exemples pour l'invite.
- Maximum 2000 exemples actifs ; ancien/moins bien noté archivé dans `library-archive.jsonl`.
- Les leçons textuelles de `learning.json` sont conservées séparément et ne deviennent durables qu'après la même validation humaine.

`npm run export:dataset` produit `data/exports/dataset.jsonl`, au format messages system, user, assistant, uniquement avec les décompositions structurées validées. Aucune photo n'est exportée et aucun entraînement automatique n'est lancé. Entraînement LoRA éventuel uniquement à la demande, sur au moins 300 exemples validés équilibrés entre catégories.
Les anciens exemples de `examples.jsonl` ne sont pas promus silencieusement : une note IA préexistante n'est pas une note humaine.
