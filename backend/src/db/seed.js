const bcrypt = require('bcryptjs');

const { env } = require('../config/env');
const { initializeDatabase, getDatabase } = require('./database');
const { assertSafeDatabaseReset } = require('./safety');
const seedImages = require('./seedImages');

// ============================================================================
//  SEED de datos de prueba sobre el modelo relacional (+ tablas app_*).
//
//  Se expone `seedDatabase(db)` para sembrar de forma idempotente desde el
//  arranque del server. Sobre PostgreSQL los datos persisten, pero se mantiene
//  el seed para poblar una base vacia y para reiniciar la demo local. Todas las
//  operaciones son async (await sobre el pool de pg) y los
//  identificadores camelCase van entre comillas dobles.
//
//  Usuarios precargados (todos con contrasena "123456"):
//
//   email             | caso de demo
//   ------------------+--------------------------------------------------------
//   juan@email.com    | FLUJO COMPLETO #1 (admitido, plata, pago USD verificado)
//   ana@email.com     | FLUJO COMPLETO #2 (admitido, plata, pago USD verificado)
//   mira@email.com    | MIRA PERO NO PUJA (admitida, plata, pago SIN verificar)
//   carlos@email.com  | CATEGORIA INSUFICIENTE (admitido, comun < plata)
//   elena@email.com   | NO ADMITIDA / en revision (clientes.admitido = 'no')
//   bruno@email.com   | NO PUEDE ENTRAR (personas.estado = 'inactivo')
//   backoffice@auxion.local | EMPLEADO / operaciones internas de back-office
// ============================================================================

async function seedDatabase(db) {
  const now = new Date();
  now.setMilliseconds(0);
  const iso = (date) => date.toISOString();
  const dateOnly = (date) => iso(date).slice(0, 10);
  const timeOnly = (date) =>
    `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  const addMinutes = (date, minutes) => new Date(date.getTime() + minutes * 60 * 1000);
  const addDays = (date, days) => new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
  // Galeria de 6 fotos para un articulo a partir de una imagen. La primera queda
  // limpia (es la que se muestra como miniatura) y el resto se diferencian con un
  // sufijo ?v=n para que el conteo de fotos sea 6 (el backend deduplica por URL).
  const gallery = (url) => (url ? [url, ...[2, 3, 4, 5, 6].map((n) => `${url}?v=${n}`)] : []);

  const passwordHash = bcrypt.hashSync('123456', 10);

  // -------------------------------------------------------------------------
  // Paises
  // -------------------------------------------------------------------------
  await db
    .prepare(
      'INSERT INTO "paises" ("numero", "nombre", "nombreCorto", "capital", "nacionalidad", "idiomas") VALUES (?, ?, ?, ?, ?, ?)'
    )
    .run(1, 'Argentina', 'ARG', 'Buenos Aires', 'Argentina', 'Espanol');
  const ARG = 1;

  // -------------------------------------------------------------------------
  // Personas (base comun de empleados, subastadores, duenios y clientes)
  // -------------------------------------------------------------------------
  const insertPersona = db.prepare(
    'INSERT INTO "personas" ("documento", "nombre", "direccion", "estado") VALUES (?, ?, ?, ?) RETURNING "identificador"'
  );

  const empleadoPersona = (await insertPersona.run('20100100', 'Laura Empleada', 'Sede central', 'activo')).lastInsertRowid;
  const subastadorPersona = (await insertPersona.run('20200200', 'Martin Rematador', 'Sede central', 'activo')).lastInsertRowid;
  const duenioPersona = (await insertPersona.run('20300300', 'Diego Duenio', 'Av. Siempre Viva 100', 'activo')).lastInsertRowid;

  const juanPersona = (await insertPersona.run('30111222', 'Juan Perez', 'Av. Libertador 1234, CABA', 'activo')).lastInsertRowid;
  const anaPersona = (await insertPersona.run('28999888', 'Ana Gomez', 'San Martin 450, Cordoba', 'activo')).lastInsertRowid;
  const miraPersona = (await insertPersona.run('27555444', 'Mira Vista', 'Mitre 800, Rosario', 'activo')).lastInsertRowid;
  const carlosPersona = (await insertPersona.run('26444333', 'Carlos Comun', 'Belgrano 50, La Plata', 'activo')).lastInsertRowid;
  const elenaPersona = (await insertPersona.run('25333222', 'Elena Revision', 'Sarmiento 90, Mendoza', 'activo')).lastInsertRowid;
  // persona inhabilitada (no podra iniciar sesion)
  const brunoPersona = (await insertPersona.run('24222111', 'Bruno Bloqueado', 'Rivadavia 10, CABA', 'inactivo')).lastInsertRowid;

  // -------------------------------------------------------------------------
  // Empleados / subastadores / duenios / seguros
  // -------------------------------------------------------------------------
  await db
    .prepare('INSERT INTO "empleados" ("identificador", "cargo", "sector") VALUES (?, ?, NULL)')
    .run(empleadoPersona, 'Revisor de productos');
  await db
    .prepare('INSERT INTO "subastadores" ("identificador", "matricula", "region") VALUES (?, ?, ?)')
    .run(subastadorPersona, 'MAT-001', 'Buenos Aires');
  await db
    .prepare(
      `INSERT INTO "duenios" ("identificador", "numeroPais", "verificacionFinanciera", "verificacionJudicial", "calificacionRiesgo", "verificador")
       VALUES (?, ?, 'si', 'si', 2, ?)`
    )
    .run(duenioPersona, ARG, empleadoPersona);
  await db
    .prepare(
      `INSERT INTO "duenios" ("identificador", "numeroPais", "verificacionFinanciera", "verificacionJudicial", "calificacionRiesgo", "verificador")
       VALUES (?, ?, 'si', 'si', 2, ?)`
    )
    .run(juanPersona, ARG, empleadoPersona);

  await db
    .prepare('INSERT INTO "seguros" ("nroPoliza", "compania", "polizaCombinada", "importe") VALUES (?, ?, ?, ?)')
    .run('POL-001', 'La Aseguradora SA', 'no', 50000);

  // -------------------------------------------------------------------------
  // Clientes (los postores de prueba)
  // -------------------------------------------------------------------------
  const insertCliente = db.prepare(
    'INSERT INTO "clientes" ("identificador", "numeroPais", "admitido", "categoria", "verificador") VALUES (?, ?, ?, ?, ?)'
  );
  await insertCliente.run(juanPersona, ARG, 'si', 'plata', empleadoPersona);
  await insertCliente.run(anaPersona, ARG, 'si', 'plata', empleadoPersona);
  await insertCliente.run(miraPersona, ARG, 'si', 'plata', empleadoPersona);
  await insertCliente.run(carlosPersona, ARG, 'si', 'comun', empleadoPersona);
  await insertCliente.run(elenaPersona, ARG, 'no', 'comun', empleadoPersona); // no admitida
  await insertCliente.run(brunoPersona, ARG, 'si', 'oro', empleadoPersona); // persona inactiva

  // -------------------------------------------------------------------------
  // Credenciales de la app (login) + cuenta de cobro de juan
  // -------------------------------------------------------------------------
  const insertCred = db.prepare(
    'INSERT INTO "app_credenciales" ("persona", "email", "passwordHash") VALUES (?, ?, ?)'
  );
  await insertCred.run(empleadoPersona, 'backoffice@auxion.local', passwordHash);
  await insertCred.run(juanPersona, 'juan@email.com', passwordHash);
  await insertCred.run(anaPersona, 'ana@email.com', passwordHash);
  await insertCred.run(miraPersona, 'mira@email.com', passwordHash);
  await insertCred.run(carlosPersona, 'carlos@email.com', passwordHash);
  await insertCred.run(elenaPersona, 'elena@email.com', passwordHash);
  await insertCred.run(brunoPersona, 'bruno@email.com', passwordHash);

  await db
    .prepare(
      'UPDATE "app_credenciales" SET "cuentaCobroBanco" = ?, "cuentaCobroCbu" = ?, "cuentaCobroAlias" = ? WHERE "persona" = ?'
    )
    .run('Banco Galicia', '0070000000000000000000', 'ARTE.SUBASTA.OK', juanPersona);

  // -------------------------------------------------------------------------
  // Medios de pago (auxiliar). Definen quien puede pujar.
  // -------------------------------------------------------------------------
  const insertPago = db.prepare(
    `INSERT INTO "app_mediosPago" ("cliente", "tipo", "alias", "moneda", "numero", "banco", "montoGarantia", "verificado")
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  // juan: tres medios verificados (uno USD para la subasta en vivo en USD)
  await insertPago.run(juanPersona, 'tarjeta', 'Visa internacional terminada en 4242', 'USD', '** ** ** 4242', 'Banco Galicia', null, 1);
  await insertPago.run(juanPersona, 'cuenta_bancaria', 'Cuenta sueldo Galicia', 'ARS', 'Account ending 0000', 'Banco Galicia', null, 1);
  await insertPago.run(juanPersona, 'cheque_certificado', 'Cheque certificado USD 15000', 'USD', null, 'Banco Nacion', 15000, 1);
  // ana: una tarjeta USD verificada -> puede competir con juan
  await insertPago.run(anaPersona, 'tarjeta', 'Visa Ana terminada en 1111', 'USD', '** ** ** 1111', 'Banco Provincia', null, 1);
  // mira: tarjeta USD SIN verificar -> puede mirar pero no pujar
  await insertPago.run(miraPersona, 'tarjeta', 'Tarjeta pendiente de verificacion', 'USD', '** ** ** 2222', 'Banco Ciudad', null, 0);
  // carlos: tarjeta USD verificada -> el bloqueo es la categoria, no el pago
  await insertPago.run(carlosPersona, 'tarjeta', 'Visa Carlos terminada en 3333', 'USD', '** ** ** 3333', 'Banco Nacion', null, 1);

  // -------------------------------------------------------------------------
  // Subastas (en vivo / proxima / finalizada)
  // -------------------------------------------------------------------------
  const insertSubasta = db.prepare(
    `INSERT INTO "subastas"
      ("fecha", "hora", "estado", "subastador", "ubicacion", "capacidadAsistentes", "tieneDeposito", "seguridadPropia", "categoria")
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING "identificador"`
  );
  const subastaLive = (await insertSubasta.run(
    dateOnly(now), timeOnly(now), 'abierta', subastadorPersona, 'Buenos Aires', 100, 'si', 'si', 'plata'
  )).lastInsertRowid;
  const subastaProxima = (await insertSubasta.run(
    dateOnly(addDays(now, 1)), timeOnly(now), 'abierta', subastadorPersona, 'Online', 200, 'no', 'si', 'especial'
  )).lastInsertRowid;
  const subastaFinalizada = (await insertSubasta.run(
    dateOnly(addDays(now, -5)), timeOnly(now), 'cerrada', subastadorPersona, 'Cordoba', 80, 'si', 'no', 'comun'
  )).lastInsertRowid;

  // -------------------------------------------------------------------------
  // Productos (de Diego Duenio, revisados por la empleada)
  // -------------------------------------------------------------------------
  const insertProducto = db.prepare(
    `INSERT INTO "productos" ("fecha", "disponible", "descripcionCatalogo", "descripcionCompleta", "revisor", "duenio", "seguro")
     VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING "identificador"`
  );
  const prodA = (await insertProducto.run(
    '1968', 'si', 'Cuadro "Amanecer Abstracto"',
    'Oleo sobre lienzo de gran formato (60x80cm). Composicion vibrante y dinamica. Marco de madera. Pertenecio a una coleccion familiar de Buenos Aires.',
    empleadoPersona, duenioPersona, 'POL-001'
  )).lastInsertRowid;
  const prodB = (await insertProducto.run(
    '1985', 'si', 'Escultura en bronce "El pensador moderno"',
    'Pieza de bronce con base de marmol, diseno moderno en excelente estado. Adquirida en galeria local y conservada en deposito privado.',
    empleadoPersona, duenioPersona, null
  )).lastInsertRowid;
  const prodC = (await insertProducto.run(
    '1940', 'si', 'Anillo antiguo con zafiro',
    'Joya antigua con montura clasica y piedra central azul. Incluye estuche de conservacion. Coleccion privada de familia argentina.',
    empleadoPersona, duenioPersona, null
  )).lastInsertRowid;
  const prodD = (await insertProducto.run(
    '1910', 'no', 'Antiguedad colonial restaurada',
    'Mueble antiguo restaurado con terminaciones originales. Incluye certificado de autenticidad y procedencia familiar de Cordoba.',
    empleadoPersona, duenioPersona, null
  )).lastInsertRowid;
  const prodE = (await insertProducto.run(
    '1950', 'si', 'Vajilla de porcelana inglesa',
    'Juego de porcelana de 24 piezas presentado por Juan Perez, revisado y asignado a una subasta proxima.',
    empleadoPersona, juanPersona, 'POL-001'
  )).lastInsertRowid;
  const prodF = (await insertProducto.run(
    '1975', 'no', 'Camara fotografica analogica',
    'Camara analogica con lente original, vendida en una subasta finalizada de demo.',
    empleadoPersona, juanPersona, 'POL-001'
  )).lastInsertRowid;

  // -------------------------------------------------------------------------
  // Imagenes opcionales de los productos (lotes).
  // Tabla auxiliar app_productoImagen (productos no modela una URL de imagen).
  // -------------------------------------------------------------------------
  // Solo si se resolvio la URL base de Storage; si no, se omiten (el front cae al
  // placeholder) y se evita insertar una url invalida en una columna NOT NULL.
  if (seedImages.baseUrl) {
    const insertProductoImagen = db.prepare(
      'INSERT INTO "app_productoImagen" ("producto", "url") VALUES (?, ?)'
    );
    await insertProductoImagen.run(prodA, seedImages.lotes.cuadro);
    await insertProductoImagen.run(prodB, seedImages.lotes.escultura);
    await insertProductoImagen.run(prodC, seedImages.lotes.anillo);
    await insertProductoImagen.run(prodD, seedImages.lotes.antiguedad);
    await insertProductoImagen.run(prodE, seedImages.lotes.vajilla);
    await insertProductoImagen.run(prodF, seedImages.lotes.camara);
  }

  // -------------------------------------------------------------------------
  // Catalogos (1 por subasta). Su descripcion funciona como titulo de la subasta.
  // -------------------------------------------------------------------------
  const insertCatalogo = db.prepare(
    'INSERT INTO "catalogos" ("descripcion", "subasta", "responsable") VALUES (?, ?, ?) RETURNING "identificador"'
  );
  const catLive = (await insertCatalogo.run('Subasta de Arte Contemporaneo #102', subastaLive, empleadoPersona)).lastInsertRowid;
  const catProxima = (await insertCatalogo.run('Coleccion Privada de Joyas #103', subastaProxima, empleadoPersona)).lastInsertRowid;
  const catFin = (await insertCatalogo.run('Subasta finalizada de prueba #101', subastaFinalizada, empleadoPersona)).lastInsertRowid;

  // -------------------------------------------------------------------------
  // Items de catalogo (lo que se subasta). subastado 'no' salvo el ya vendido.
  // -------------------------------------------------------------------------
  const insertItem = db.prepare(
    'INSERT INTO "itemsCatalogo" ("catalogo", "producto", "precioBase", "comision", "subastado") VALUES (?, ?, ?, ?, ?) RETURNING "identificador"'
  );
  const itemA = (await insertItem.run(catLive, prodA, 10000, 500, 'no')).lastInsertRowid;
  await insertItem.run(catLive, prodB, 3200, 200, 'no');
  await insertItem.run(catProxima, prodC, 180000, 9000, 'no');
  const itemD = (await insertItem.run(catFin, prodD, 220000, 11000, 'si')).lastInsertRowid; // ya subastado
  await insertItem.run(catProxima, prodE, 8000, 400, 'no');
  await insertItem.run(catFin, prodF, 75000, 3750, 'si');

  // -------------------------------------------------------------------------
  // Runtime de la sala en vivo (moneda + tiempos por articulo)
  // -------------------------------------------------------------------------
  const insertRuntime = db.prepare(
    'INSERT INTO "app_subastaRuntime" ("subasta", "moneda", "abiertaEn", "inicioProgramado") VALUES (?, ?, ?, ?)'
  );
  // En vivo: USD, sin abiertaEn -> el reloj arranca cuando alguien entra a la sala.
  await insertRuntime.run(subastaLive, 'USD', null, null);
  // Proxima: ARS, arranca programada para dentro de 60 minutos.
  await insertRuntime.run(subastaProxima, 'ARS', null, iso(addMinutes(now, 60)));
  // Finalizada: ARS, ya cerrada.
  await insertRuntime.run(subastaFinalizada, 'ARS', iso(addDays(now, -5)), null);

  // -------------------------------------------------------------------------
  // Subasta finalizada con ganador (juan): asistente + pujo ganador + registro
  // -------------------------------------------------------------------------
  const asistJuanFin = (await db
    .prepare('INSERT INTO "asistentes" ("numeroPostor", "cliente", "subasta") VALUES (?, ?, ?) RETURNING "identificador"')
    .run(201, juanPersona, subastaFinalizada)).lastInsertRowid;
  const pujoFinalizada = (await db
    .prepare(`INSERT INTO "pujos" ("asistente", "item", "importe", "ganador") VALUES (?, ?, ?, 'si') RETURNING "identificador"`)
    .run(asistJuanFin, itemD, 250000)).lastInsertRowid;
  const medioPagoJuanArs = await db
    .prepare('SELECT identificador FROM "app_mediosPago" WHERE cliente = ? AND moneda = ? ORDER BY identificador ASC LIMIT 1')
    .get(juanPersona, 'ARS');
  if (medioPagoJuanArs) {
    await db
      .prepare(
        `INSERT INTO "app_pujaMedioPago" ("pujo", "medioPago", "cliente", "moneda", "monto")
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(pujoFinalizada, medioPagoJuanArs.identificador, juanPersona, 'ARS', 250000);
  }
  await db
    .prepare(
      'INSERT INTO "registroDeSubasta" ("subasta", "duenio", "producto", "cliente", "importe", "comision") VALUES (?, ?, ?, ?, ?, ?)'
    )
    .run(subastaFinalizada, duenioPersona, prodD, juanPersona, 250000, 11000);

  // -------------------------------------------------------------------------
  // Mensajes / alertas para la pantalla Actividad
  // -------------------------------------------------------------------------
  const insertMensaje = db.prepare(
    'INSERT INTO "app_mensajes" ("persona", "titulo", "cuerpo", "tipo") VALUES (?, ?, ?, ?)'
  );
  await insertMensaje.run(juanPersona, 'Bienvenido a Auxion', 'Tu cuenta esta admitida y ya podes participar en subastas habilitadas.', 'mensaje');
  await insertMensaje.run(juanPersona, 'Medio de pago verificado', 'Tu tarjeta internacional ya se encuentra verificada para operar en USD.', 'alerta');
  await insertMensaje.run(juanPersona, 'Subasta ganada', 'Ganaste "Antiguedad colonial restaurada" por ARS 250000. Revisar condiciones de pago.', 'alerta');
  await insertMensaje.run(anaPersona, 'Bienvenida a Auxion', 'Tu cuenta esta admitida y tu tarjeta USD esta verificada. Ya podes pujar.', 'mensaje');
  await insertMensaje.run(miraPersona, 'Medio de pago pendiente', 'Tu medio de pago todavia no fue verificado. Podras mirar las subastas pero no pujar.', 'alerta');
  await insertMensaje.run(elenaPersona, 'Solicitud en revision', 'Tu solicitud esta en revision. Te avisaremos cuando seas admitida.', 'mensaje');

  // -------------------------------------------------------------------------
  // Articulos propuestos por juan (flujo "publicar articulo", auxiliar)
  // -------------------------------------------------------------------------
  const insertArticulo = db.prepare(
    `INSERT INTO "app_articulos" ("persona", "titulo", "descripcion", "imagenFrente", "imagenDorso", "precioEstimado", "estado", "condicionesVenta", "producto")
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING "identificador"`
  );
  const artAprobado = (await insertArticulo.run(
    juanPersona, 'Reloj de bolsillo antiguo',
    'Reloj suizo de bolsillo circa 1920, mecanismo a cuerda en funcionamiento.',
    seedImages.articulos.reloj, seedImages.articulos.reloj, 5000, 'aprobado',
    'Retiro en Buenos Aires o envio por cuenta del comprador.', null
  )).lastInsertRowid;
  const artRevision = (await insertArticulo.run(
    juanPersona, 'Coleccion de monedas argentinas',
    'Lote de 25 monedas conmemorativas argentinas, decadas del 60 al 90.',
    seedImages.articulos.monedas, null, 1200, 'en_revision', null, null
  )).lastInsertRowid;
  const artPropuesta = (await insertArticulo.run(
    juanPersona, 'Cuadro al oleo paisaje serrano',
    'Oleo sobre lienzo 50x70cm, paisaje de las sierras de Cordoba.',
    seedImages.articulos.cuadro, null, 3500, 'propuesta', null, null
  )).lastInsertRowid;
  const artRechazado = (await insertArticulo.run(
    juanPersona, 'Lampara art deco para evaluar',
    'Lampara art deco con cableado original y marcas de restauracion.',
    seedImages.articulos.lampara, seedImages.articulos.lampara, 900, 'rechazado', null, null
  )).lastInsertRowid;
  const artEnSubasta = (await insertArticulo.run(
    juanPersona, 'Vajilla de porcelana inglesa',
    'Juego de porcelana de 24 piezas aceptado y asignado a una subasta proxima.',
    seedImages.articulos.vajilla, seedImages.articulos.vajilla, 8000, 'en_subasta',
    'Valor base y comision aceptados por el usuario.', prodE
  )).lastInsertRowid;
  const artVendido = (await insertArticulo.run(
    juanPersona, 'Camara fotografica analogica',
    'Camara analogica con lente original vendida en subasta finalizada.',
    seedImages.articulos.camara, seedImages.articulos.camara, 75000, 'vendido',
    'Articulo vendido en subasta finalizada.', prodF
  )).lastInsertRowid;

  const insertArticuloDoc = db.prepare(
    `INSERT INTO "app_articuloDocumentacion"
      ("articulo", "fotos", "informacionHistorica", "documentoOrigen", "declaracionPropiedad", "aceptaDevolucionConCargo")
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  const declaracionPropiedad = 'Declaro bajo juramento ser legitimo propietario del articulo o tener derechos para venderlo.';
  await insertArticuloDoc.run(
    artAprobado,
    JSON.stringify(gallery(seedImages.articulos.reloj)),
    'Pieza heredada de coleccion familiar, conservada en caja original.',
    'certificado_reloj.pdf',
    declaracionPropiedad,
    1
  );
  await insertArticuloDoc.run(
    artRevision,
    JSON.stringify(gallery(seedImages.articulos.monedas)),
    'Coleccion formada entre 1960 y 1990 por familiar directo.',
    'certificado_monedas.pdf',
    declaracionPropiedad,
    1
  );
  await insertArticuloDoc.run(
    artPropuesta,
    JSON.stringify(gallery(seedImages.articulos.cuadro)),
    'Obra comprada en Cordoba y conservada en domicilio particular.',
    'certificado_cuadro.pdf',
    declaracionPropiedad,
    1
  );
  await insertArticuloDoc.run(
    artRechazado,
    JSON.stringify(gallery(seedImages.articulos.lampara)),
    'Pieza familiar restaurada parcialmente antes de la revision.',
    'certificado_lampara.pdf',
    declaracionPropiedad,
    1
  );
  await insertArticuloDoc.run(
    artEnSubasta,
    JSON.stringify(gallery(seedImages.articulos.vajilla)),
    'Pertenecio a una coleccion familiar y se conserva completa.',
    'certificado_vajilla.pdf',
    declaracionPropiedad,
    1
  );
  await insertArticuloDoc.run(
    artVendido,
    JSON.stringify(gallery(seedImages.articulos.camara)),
    'Camara comprada por familiar directo y conservada con estuche original.',
    'certificado_camara.pdf',
    declaracionPropiedad,
    1
  );
  await db
    .prepare(
      `UPDATE "app_articuloDocumentacion"
       SET "aceptaCondiciones" = 1,
           "condicionesRespondidasEn" = to_char(now() at time zone 'utc','YYYY-MM-DD HH24:MI:SS')
       WHERE "articulo" IN (?, ?)`
    )
    .run(artEnSubasta, artVendido);

  const insertSeg = db.prepare(
    'INSERT INTO "app_articuloSeguimiento" ("articulo", "estado", "descripcion") VALUES (?, ?, ?)'
  );
  await insertSeg.run(artAprobado, 'propuesta', 'Propuesta recibida. Sera evaluada por el equipo.');
  await insertSeg.run(artAprobado, 'en_revision', 'Articulo en revision por el equipo de catalogacion.');
  await insertSeg.run(artAprobado, 'aprobado', 'Articulo aprobado para subasta. Se asignara a un catalogo proximo.');
  // Paso 'aceptado': habilita en la app la revision/aceptacion de las condiciones
  // de venta (precio base y comisiones informadas al duenio).
  await insertSeg.run(artAprobado, 'aceptado', 'Tasacion y comisiones informadas. Revisa y acepta las condiciones de venta.');
  await insertSeg.run(artRevision, 'propuesta', 'Propuesta recibida. Sera evaluada por el equipo.');
  await insertSeg.run(artRevision, 'en_revision', 'Articulo en revision por el equipo de catalogacion.');
  await insertSeg.run(artPropuesta, 'propuesta', 'Propuesta recibida. Sera evaluada por el equipo.');
  await insertSeg.run(artRechazado, 'propuesta', 'Propuesta recibida. Sera evaluada por el equipo.');
  await insertSeg.run(artRechazado, 'en_revision', 'Articulo en revision por el equipo de catalogacion.');
  await insertSeg.run(artRechazado, 'rechazado', 'No se acepta para subasta por falta de documentacion tecnica suficiente sobre una restauracion previa.');
  await insertSeg.run(artEnSubasta, 'propuesta', 'Propuesta recibida. Sera evaluada por el equipo.');
  await insertSeg.run(artEnSubasta, 'en_revision', 'Articulo inspeccionado por el equipo de catalogacion.');
  await insertSeg.run(artEnSubasta, 'aprobado', 'Articulo aprobado para subasta.');
  await insertSeg.run(artEnSubasta, 'aceptado', 'Tasacion y comisiones informadas. Revisa y acepta las condiciones de venta.');
  await insertSeg.run(artEnSubasta, 'condiciones_aceptadas', 'El usuario acepto el valor base y la comision informados.');
  await insertSeg.run(artEnSubasta, 'en_subasta', 'Articulo asignado a la subasta Coleccion Privada de Joyas #103.');
  await insertSeg.run(artVendido, 'propuesta', 'Propuesta recibida. Sera evaluada por el equipo.');
  await insertSeg.run(artVendido, 'en_revision', 'Articulo inspeccionado por el equipo de catalogacion.');
  await insertSeg.run(artVendido, 'aprobado', 'Articulo aprobado para subasta.');
  await insertSeg.run(artVendido, 'aceptado', 'Tasacion y comisiones informadas. Revisa y acepta las condiciones de venta.');
  await insertSeg.run(artVendido, 'condiciones_aceptadas', 'El usuario acepto el valor base y la comision informados.');
  await insertSeg.run(artVendido, 'en_subasta', 'Articulo incluido en una subasta finalizada de demo.');
  await insertSeg.run(artVendido, 'vendido', 'Articulo vendido en subasta. El pago se enviara a la cuenta de cobro declarada.');
}

// Siembra solo si la base esta vacia (idempotente). Pensado para el arranque del
// server: el primer deploy encuentra la base sin datos y la puebla.
async function seedIfEmpty(db) {
  const row = await db.prepare('SELECT COUNT(*) AS c FROM "subastas"').get();
  if (row.c === 0) {
    await db.transaction((tx) => seedDatabase(tx));
    return true;
  }
  return false;
}

// Todas las tablas (para el TRUNCATE del reset). El RESTART IDENTITY reinicia los
// contadores de identidad y CASCADE resuelve las FK.
const ALL_TABLES = [
  'registroDeSubasta', 'pujos', 'asistentes',
  'app_pujaMedioPago', 'app_articuloSeguimiento', 'app_articuloDocumentacion', 'app_articulos', 'app_mensajes', 'app_subastaRuntime',
  'itemsCatalogo', 'catalogos', 'fotos', 'app_productoImagen', 'productos',
  'app_password_resets', 'app_mediosPago', 'app_pre_registros', 'app_credenciales', 'clientes', 'duenios', 'subastadores',
  'subastas', 'seguros', 'sectores', 'empleados', 'personas', 'paises',
];

// Reinicia la demo a estado fresco: borra todo y vuelve a sembrar. Util para
// volver a probar el circuito de puja online (la subasta en vivo finaliza 1
// minuto por articulo, asi que sin un reset quedaria cerrada tras el demo).
async function resetAndSeed(db, options = {}) {
  if (!options.skipSafety) {
    assertSafeDatabaseReset(env);
  }
  const truncate = `TRUNCATE ${ALL_TABLES.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`;
  await db.transaction(async (tx) => {
    await tx.prepare(truncate).run();
    await seedDatabase(tx);
  });
}

// Ejecucion como script (`npm run seed`): asegura el esquema y resiembra limpio.
if (require.main === module) {
  (async () => {
    await initializeDatabase();
    await resetAndSeed(getDatabase());
    console.log('Local PostgreSQL database initialized and demo seed loaded.');
    console.log('Usuarios: juan/ana (flujo completo), mira (sin pago verificado), carlos (categoria baja), elena (no admitida), bruno (inhabilitado), backoffice@auxion.local (empleado). Pass: 123456');
    await getDatabase().close();
    process.exit(0);
  })().catch((error) => {
    console.error('Error al sembrar la base:', error);
    process.exit(1);
  });
}

module.exports = { seedDatabase, seedIfEmpty, resetAndSeed };
