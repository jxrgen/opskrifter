// Kilder til opskrifter. Valdemarsro hentes først; de øvrige er danske madsider,
// der også udgiver opskrifter med struktureret data (schema.org/Recipe).
//
// sitemaps: kandidater – den første der svarer, bruges (robots.txt tjekkes også for Sitemap-linjer)
// seeds:    oversigtssider med vegetariske opskrifter – links herfra får "vegetar-signal"
// maxNew:   maks. antal nye sider der hentes pr. kørsel (skånsomt for kilden; resten tages næste dag)

export const SOURCES = [
  {
    id: 'valdemarsro',
    name: 'Valdemarsro',
    base: 'https://www.valdemarsro.dk',
    sitemaps: [
      'https://www.valdemarsro.dk/sitemap_index.xml',
      'https://www.valdemarsro.dk/sitemap.xml',
      'https://www.valdemarsro.dk/wp-sitemap.xml',
    ],
    seeds: [
      'https://www.valdemarsro.dk/vegetar/',
      'https://www.valdemarsro.dk/vegetarretter/',
      'https://www.valdemarsro.dk/vegetaropskrifter/',
      'https://www.valdemarsro.dk/vegansk/',
    ],
    maxNew: 2500,
  },
  {
    id: 'madensverden',
    name: 'Madens Verden',
    base: 'https://madensverden.dk',
    sitemaps: ['https://madensverden.dk/sitemap_index.xml', 'https://madensverden.dk/sitemap.xml'],
    seeds: ['https://madensverden.dk/vegetar/', 'https://madensverden.dk/vegetariske-opskrifter/'],
    maxNew: 1200,
  },
  {
    id: 'mummum',
    name: 'Mummum',
    base: 'https://mummum.dk',
    sitemaps: ['https://mummum.dk/sitemap_index.xml', 'https://mummum.dk/sitemap.xml'],
    seeds: ['https://mummum.dk/vegetar/', 'https://mummum.dk/kategori/vegetar/'],
    maxNew: 1200,
  },
  {
    id: 'louisesmadblog',
    name: 'Louises Madblog',
    base: 'https://www.louisesmadblog.dk',
    sitemaps: ['https://www.louisesmadblog.dk/sitemap_index.xml', 'https://www.louisesmadblog.dk/sitemap.xml'],
    seeds: ['https://www.louisesmadblog.dk/vegetar/'],
    maxNew: 1000,
  },
];
