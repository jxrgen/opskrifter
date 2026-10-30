import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractRecipe, buildRecord, textTime } from '../scraper/scrape.js';

const src = { id: 'valdemarsro', name: 'Valdemarsro' };
const ld = (o) => `<html><head><meta property="og:image" content="https://x/img.jpg"><script type="application/ld+json">${JSON.stringify(o)}</script></head><body></body></html>`;

test('JSON-LD med @graph', () => {
  const html = ld({ '@context': 'https://schema.org', '@graph': [{ '@type': 'WebPage' }, {
    '@type': 'Recipe', name: 'Grøntsagslasagne &amp; salat', description: 'En lækker lasagne.',
    recipeIngredient: ['2 dl piskefløde', '1 squash', '200 g linser', '0,5 tsk salt, peber'], totalTime: 'PT1H10M', recipeYield: ['4', '4 personer'],
    recipeCategory: 'Aftensmad', keywords: 'vegetar, lasagne', aggregateRating: { ratingValue: '4.6', ratingCount: '120' },
  }] });
  const r = extractRecipe(html, 'https://www.valdemarsro.dk/groentsagslasagne/');
  assert.equal(r.title, 'Grøntsagslasagne & salat');
  assert.equal(r.minutes, 70);
  assert.equal(r.ingredients.length, 4);
  assert.equal(r.servings, 4);
  assert.equal(r.image, 'https://x/img.jpg');
  const b = buildRecord(src, 'https://www.valdemarsro.dk/groentsagslasagne/', r, false);
  assert.equal(b.status, 'ok');
  assert.equal(b.recipe.time, 'lang');
  assert.deepEqual(b.recipe.dairy.map((d) => d.i), [0]);
  assert.ok(b.recipe.courses.includes('aftensmad'));
});

test('kød afvises', () => {
  const r = extractRecipe(ld({ '@type': 'Recipe', name: 'Lasagne', recipeIngredient: ['500 g hakket oksekød', '1 løg'] }), 'u');
  assert.equal(buildRecord(src, 'https://x.dk/a/', r, true).status, 'animal');
});

test('microdata og fri-tekst tid', () => {
  const html = `<meta property="og:title" content="Tomatsuppe"><ul><li itemprop="recipeIngredient">1 kg <b>tomater</b></li><li itemprop="recipeIngredient">1 løg</li></ul><p>Tid i alt: 35 min</p>`;
  const r = extractRecipe(html, 'u');
  assert.deepEqual(r.ingredients, ['1 kg tomater', '1 løg']);
  assert.equal(textTime(html), 35);
});
