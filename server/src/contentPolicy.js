// Conservative text guards for explicit requests forbidden by the project policy.
// They are not a comprehensive copyright or legal-content classifier.
const disallowed=[
  {code:'PROTECTED_LOGO',regex:/\b(?:logo\s+(?:officiel|de|du|d['’])|marque\s+d[ée]pos[ée]e|trademark)\b/i},
  {code:'PROTECTED_CHARACTER',regex:/\b(?:mario|luigi|pikachu|pokemon|pok[ée]mon|mickey|donald\s+duck|sonic\s+the\s+hedgehog)\b/i},
  {code:'IDENTIFIABLE_PERSON',regex:/\b(?:portrait|visage|sculpture|mod[èe]le\s+3d)\s+(?:de|d['’])\s+(?:[A-ZÀ-Ý][a-zà-ÿ]+\s+[A-ZÀ-Ý][a-zà-ÿ]+)\b/u},
];
export function classifyRestrictedText(text){
  const value=String(text||'').slice(0,5000);
  const found=disallowed.find(entry=>entry.regex.test(value));
  return found?.code||null;
}
export function assertAllowedBrief(brief){
  const restriction=classifyRestrictedText(brief);
  if(restriction)throw Object.assign(new Error('La demande semble décrire un logo, un personnage protégé ou une personne réelle identifiable. Utilise un design original et générique.'),{code:'CONTENT_RESTRICTED',details:{restriction}});
}
