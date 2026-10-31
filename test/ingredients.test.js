import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanTitle, checkAnimalLine, checkAnimalTitle, checkRecipe, checkDairyLine,
  isoDurationToMinutes, timeBucket, parseIngredient, scaleIngredient, ingredientKey,
} from '../lib/ingredients.js';

const meat = [
  '500 g hakket oksekød', '4 kyllingebryst', '100 g bacon i tern', '2 laksefiletter',
  '200 g rejer', '1 spsk fiskesauce', '1 tsk worcestershire sauce', '6 ansjoser',
  '4 skiver parmaskinke', '1 kalkunbryst', '300 g lammekølle', '2 spsk østerssauce',
  '1 dåse tun i vand', '200 g røget ål', '1 andebryst', '400 g hakket kød', '4 frikadeller',
  '3 blade husblas', '200 g chorizo', '1 l kyllingebouillon', '1 terning hønsebouillon',
  '8 pølser', '2 dl kalvefond', '150 g spegepølse', '1 kg svinekam', '400 g torskefilet',
  '2 tsk rejepasta', '100 g stenbiderrogn', '1 lever', '200 g muslinger', '100 g flæsk',
  'vegetarisk hakket kød eller oksekød', '600 g flanksteak', '4 store koteletter med ben', '600 g lyssej (uden skind og ben)',
  '600 g lange (langefilet uden ben)', '2 ørredfileter', '4 tunsteaks', '1 kg spareribs', '800 g cuvettesteg', '1 spsk dyrefedt', '100 g skumfiduser', '1 suppehøne', '4 slethvar fileter', '2 mørksej fileter', '2 pakker hotwings (800 gram)', '600 g Ibérico Presa', '2 ribeye', '50 g caviar', '400 g salsiccia', 'Nyretapper (250 g pr. person)', '4 stk hvilling (fileter )', '2 gråænder/vildænder', '600 g cote de bouef', '800 g flankesteg', '4 kålpølser', '8 stk revelsben', '600 g pluma', '1,5 kg porchetta', '100 g guianciale', '60 g ventricina', '8 isingfileter', '1 stk andeskrog', 'tomatsauce med kødboller', '300 g svampe og 500 g hakket kød',
];
const veg = [
  '1 rødløg', '2 fed hvidløg', '200 g rødkål', '1 hvidkål', '400 g linsefrikadeller',
  '1 dl plantefløde', '200 g vegetarisk hakket kød', '2 spsk smør', '4 æg', '1 spsk honning',
  '250 g østershatte', '1 pose lammeøresalat', '2 tsk hjortetakssalt', 'frugtkødet af 1 avocado',
  '1 l grøntsagsbouillon', '2 bønnebøffer', '200 g champignon', '1 pakke grissini',
  '2 dl kokosmælk', '1 håndfuld mandler', '1 dl vand', 'græskarkød fra ½ hokkaido',
  '4 vegetarpølser', '4 burgerboller', '8 hotdogbrød', 'den anden halvdel af citronen', '25 g hasselnødder (uden skind)', '4 blomkålssteaks', '2 ribs', '1 pose Uncle Ben\'s ris', '50 g soltørrede tomater', '2 spsk frysetørrede hindbær', '2 appelsinfileter', '1 blomkål (i buketter)', '200 g blomkålswings', '1 pk plantebaserede kødboller', '2 dl kikærtevand', '1 spsk miso', '6 vagtelæg', '1 blodappelsin',
];

test('kød/fisk fanges', () => {
  for (const l of meat) assert.ok(checkAnimalLine(l).hit, `burde fanges: ${l}`);
});

test('vegetariske ingredienser slipper igennem', () => {
  for (const l of veg) assert.equal(checkAnimalLine(l).hit, null, `fejlagtigt fanget: ${l} → ${checkAnimalLine(l).hit}`);
});

test('tvetydig bouillon', () => {
  assert.ok(checkAnimalLine('1 l bouillon').ambiguous);
  assert.ok(checkAnimalLine('2 bouillonterninger').ambiguous);
  assert.equal(checkAnimalLine('1 l grøntsagsbouillon').ambiguous, null);
  const r = checkRecipe({ title: 'Linsesuppe', ingredients: ['1 l bouillon', '200 g linser'] }, false);
  assert.equal(r.ok, false);
  assert.equal(checkRecipe({ title: 'Linsesuppe', ingredients: ['1 l bouillon'] }, true).ok, true);
});

test('titler', () => {
  assert.ok(checkAnimalTitle('Kylling i karry'));
  assert.ok(checkAnimalTitle('Pasta med laks og spinat'));
  assert.equal(checkAnimalTitle('Vegetar frikadeller med kartoffelsalat'), null);
  assert.equal(checkAnimalTitle('Linsefrikadeller'), null);
  assert.equal(checkAnimalTitle('Bønneburger med coleslaw'), null);
  assert.equal(checkAnimalTitle('Salat spækket med grønt'), null);
  assert.equal(checkAnimalTitle('Grøntsagslasagne'), null);
  assert.equal(checkAnimalTitle('Vegetarisk sloppy joes burger'), null);
  assert.equal(checkAnimalTitle('Macaroni and cheese'), null);
  assert.ok(checkAnimalTitle('Vegetarisk lasagne med kylling'));
  assert.ok(checkAnimalTitle('Flanksteak med ovnbagte kartofler'));
  assert.equal(checkAnimalTitle('Blomkålssteak med tahin'), null);
  assert.equal(checkAnimalTitle('Linsebolognese'), null);
  assert.equal(checkAnimalTitle('Grissini med rosmarin'), null);
  assert.ok(checkAnimalTitle('Pluma gris med pasta'));
});

test('mejeri', () => {
  for (const l of ['2 dl piskefløde', '100 g parmesan', '1 dl mælk', '200 g feta', '2 dl creme fraiche 18%',
    '150 g revet ost', '250 g mascarpone', '1 bæger skyr', '100 g hytteost', '2 dl græsk yoghurt']) {
    assert.ok(checkDairyLine(l), `mejeri: ${l}`);
  }
  for (const l of ['50 g smør', '2 dl kokosmælk', '1 dl havrefløde', '2 dl sojayoghurt', '1 dl æblemost',
    '200 g dybfrost ærter', '1 spsk rosmarin', '100 g vegansk ost', '4 æg', '2 spsk ghee', '2 dl havremælk']) {
    assert.equal(checkDairyLine(l), null, `ikke mejeri: ${l}`);
  }
});

test('tid', () => {
  assert.equal(isoDurationToMinutes('PT1H30M'), 90);
  assert.equal(isoDurationToMinutes('PT25M'), 25);
  assert.equal(isoDurationToMinutes('P0DT0H45M'), 45);
  assert.equal(isoDurationToMinutes(''), null);
  assert.equal(timeBucket(20), 'hurtig');
  assert.equal(timeBucket(60), 'mellem');
  assert.equal(timeBucket(61), 'lang');
});

test('mængder', () => {
  assert.deepEqual(parseIngredient('1½ dl piskefløde').qty, 1.5);
  assert.equal(parseIngredient('1½ dl piskefløde').unit, 'dl');
  assert.equal(parseIngredient('2-3 fed hvidløg').qty2, 3);
  assert.equal(scaleIngredient('2 dl mælk', 2), '4 dl mælk');
  assert.equal(scaleIngredient('1 rødløg', 0.5), '½ rødløg');
  assert.equal(scaleIngredient('salt og peber', 2), 'salt og peber');
  assert.equal(scaleIngredient('250 g pasta', 1.5), '375 g pasta');
  assert.equal(ingredientKey('2 rødløg, finthakket'), 'rødløg');
});

test('titler renses', () => {
  assert.equal(cleanTitle('Linsesuppe - opskrift på lækker suppe'), 'Linsesuppe');
  assert.equal(cleanTitle('Pasta med pesto - nem og hurtig hverdagsmad'), 'Pasta med pesto');
  assert.equal(cleanTitle('Chili sin carne'), 'Chili sin carne');
  assert.equal(cleanTitle('Vegetar panang karry - få opskrift her'), 'Vegetar panang karry');
});

import { checkGlutenLine, isGlutenFree, parseQuery, matchesQuery } from '../lib/ingredients.js';

test('gluten', () => {
  for (const l of ['200 g hvedemel', '3 dl mel', '250 g spaghetti', '4 lasagneplader', '1 dl rasp', '2 spsk sojasauce',
    '4 tortillas', '1 rulle butterdej', '100 g couscous', '2 dl havregryn', '1 flaske øl', '200 g speltmel', '4 skiver rugbrød', '1 portion tærtedej', '1 pizzabund']) {
    assert.ok(checkGlutenLine(l), `gluten: ${l}`);
  }
  for (const l of ['2 spsk majsstivelse', '100 g mandelmel', '1 spsk kartoffelmel', '200 g risnudler', '2 spsk tamari',
    '1 dl flormelis', '2 spsk tomatpuré', '1 spsk karrypasta', '200 g glutenfri pasta', '250 g ris', '1 spsk boghvedemel',
    '200 g majstortillas', '1 dl karamelsauce', '2 spsk rød karrypasta']) {
    assert.equal(checkGlutenLine(l), null, `ikke gluten: ${l} → ${checkGlutenLine(l)}`);
  }
  assert.equal(isGlutenFree({ ingredients: ['1 dåse kikærter', '1 dl ris'] }), true);
  assert.equal(isGlutenFree({ ingredients: ['200 g pasta'], tags: ['glutenfri'] }), true);
});

test('ingredienssøgning', () => {
  const txt = 'Ovnbagte grøntsager 2 gulerødder 1 løg 300 g kartofler';
  assert.ok(matchesQuery(parseQuery('+gulerødder +løg'), txt));
  assert.ok(!matchesQuery(parseQuery('+gulerødder +squash'), txt));
  assert.ok(!matchesQuery(parseQuery('+gulerødder -løg'), txt));
  assert.ok(matchesQuery(parseQuery('+squash|kartofler'), txt));
  assert.ok(matchesQuery(parseQuery('+squash/kartofler'), txt));
  assert.ok(!matchesQuery(parseQuery('+squash/pastinak'), txt));
  assert.ok(matchesQuery(parseQuery('gulerod kartoffel'), txt));
  assert.ok(matchesQuery(parseQuery('−squash'), txt));
  assert.ok(matchesQuery(parseQuery('"sorte bønner"'), '1 dåse sorte bønner'));
  assert.ok(!matchesQuery(parseQuery('"sorte bønner"'), '1 dåse hvide bønner og sorte oliven'));
  assert.ok(parseQuery('  ').empty);
});
