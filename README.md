# Grønne opskrifter

Website der viser tilfældige **vegetariske** opskrifter fra Valdemarsro og andre danske madsider – aldrig kød, fisk, fjerkræ, skaldyr eller gelatine. Æg, smør og honning er tilladt; mælkeprodukter vises helst ikke og får forslag til plantebaserede erstatninger.

**Side:** https://jxrgen.github.io/opskrifter/

## Sådan virker det

- `scraper/scrape.js` kører hver nat i GitHub Actions. Den finder opskrifter via kildernes sitemaps og vegetar-oversigter, læser den strukturerede opskriftsdata (schema.org/Recipe), afviser alt med dyr og gemmer resultatet i `data/recipes.json`.
- Kun nye eller ændrede sider hentes (`data/state.json` husker resten), så kilderne belastes minimalt. `robots.txt` respekteres.
- Websitet (`index.html`, `app.js`, `style.css`) er statisk og læser `data/recipes.json`.
- Filteret ligger i `lib/ingredients.js` og testes med `npm test`.

Der gemmes kun titel, kort beskrivelse, ingredienser, tid og link – fremgangsmåden læses hos kilden.

## Tilføj eller fjern kilder

Ret `scraper/sources.js` og kør workflowet igen (Actions → "Hent opskrifter og udgiv site" → Run workflow).
