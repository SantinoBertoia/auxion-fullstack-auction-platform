// Optional image URLs for demo data.
//
// A fresh local clone does not need external storage to run. When
// DEMO_IMAGE_BASE_URL is provided, the seed stores URLs such as:
//   https://example.test/images/lote-cuadro.jpg
//
// When it is not provided, the seed leaves image URLs empty and the frontend
// falls back to its built-in placeholders.

const { env } = require('../config/env');

const BASE = env.DEMO_IMAGE_BASE_URL;

const img = (name) => (BASE ? `${BASE}/${name}` : null);

const FILES = {
  cuadro: 'lote-cuadro.jpg',
  escultura: 'lote-escultura.jpg',
  anillo: 'lote-anillo.jpg',
  antiguedad: 'lote-antiguedad.jpg',
  vajilla: 'lote-vajilla.jpg',
  camara: 'lote-camara.jpg',
  reloj: 'art-reloj.jpg',
  monedas: 'art-monedas.jpg',
  cuadroArticulo: 'art-cuadro.jpg',
  lampara: 'art-lampara.jpg',
};

module.exports = {
  FILES,
  baseUrl: BASE,
  lotes: {
    cuadro: img(FILES.cuadro),
    escultura: img(FILES.escultura),
    anillo: img(FILES.anillo),
    antiguedad: img(FILES.antiguedad),
    vajilla: img(FILES.vajilla),
    camara: img(FILES.camara),
  },
  articulos: {
    reloj: img(FILES.reloj),
    monedas: img(FILES.monedas),
    cuadro: img(FILES.cuadroArticulo),
    lampara: img(FILES.lampara),
    vajilla: img(FILES.vajilla),
    camara: img(FILES.camara),
  },
};
