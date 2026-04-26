/**
 * TALLER DICO — Google Apps Script Backend
 * Code.gs — v2.0 con Historial de Servicios
 *
 * INSTALACIÓN:
 *  1. Abrí tu Google Sheet
 *  2. Extensiones → Apps Script
 *  3. Borrá el contenido del editor y pegá TODO este archivo
 *  4. Guardá (Ctrl+S)
 *  5. Implementar → Nueva implementación
 *     - Tipo: Aplicación web
 *     - Ejecutar como: Yo (tu cuenta)
 *     - Acceso: Cualquier usuario
 *  6. Copiá la URL y pegala en app.js (constante GAS_URL)
 *  7. Cada vez que modifiques Code.gs debés crear una NUEVA implementación
 *
 * ESTRUCTURA DE LA HOJA DE CÁLCULO:
 *  - Pestaña "Clientes":  ID_Cliente | Nombre | Telefono | Direccion | Email | Estado
 *  - Pestaña "Vehiculos": ID_Vehiculo | ID_Cliente | Patente | Marca | Modelo | Año | Color | Estado
 *  - Pestaña "Historial": ID_Servicio | ID_Vehiculo | Fecha | KM | Descripcion_Trabajo | Costo | Estado
 *
 * PROTOCOLO DE RESPUESTA (siempre JSON):
 *  Éxito: { ok: true,  data: <resultado> }
 *  Error: { ok: false, error: <mensaje>  }
 */


// ── NOMBRES DE PESTAÑAS (ajustá si los tuyos son distintos) ──────────────────
const SHEET_CLIENTES  = 'Clientes';
const SHEET_VEHICULOS = 'Vehiculos';
const SHEET_HISTORIAL = 'Historial';

// ── PREFIJOS PARA IDs AUTOGENERADOS ──────────────────────────────────────────
const PREFIX_CLIENTE  = 'CLI-';
const PREFIX_VEHICULO = 'VEH-';
const PREFIX_SERVICIO = 'SRV-';

// ── ESTADO PARA BORRADO LÓGICO ────────────────────────────────────────────────
const ESTADO_ACTIVO   = 'Activo';
const ESTADO_ELIMINADO = 'Eliminado';


/* ╔══════════════════════════════════════════════════╗
   ║  PUNTO DE ENTRADA — doPost                      ║
   ╚══════════════════════════════════════════════════╝ */

/**
 * Recibe todas las peticiones POST desde el frontend.
 * Lee el body JSON, despacha la acción y retorna el resultado.
 *
 * @param {Object} e - Evento de Apps Script con e.postData.contents
 * @returns {ContentService.TextOutput} JSON con { ok, data } o { ok, error }
 */
function doPost(e) {
  // Cabecera CORS para permitir llamadas desde el dominio del frontend
  const output = ContentService.createTextOutput();
  output.setMimeType(ContentService.MimeType.JSON);

  try {
    // Parsea el body enviado desde fetch() en app.js
    const { action, datos } = JSON.parse(e.postData.contents);

    let resultado;

    // Despacha la acción al handler correspondiente
    switch (action) {

      // ── CLIENTES ──
      case 'getClientesActivos':     resultado = getClientesActivos();           break;
      case 'getTodosLosClientes':    resultado = getTodosLosClientes();           break;
      case 'agregarCliente':         resultado = agregarCliente(datos);           break;
      case 'actualizarCliente':      resultado = actualizarCliente(datos);        break;
      case 'eliminarClienteLogico':  resultado = eliminarClienteLogico(datos.id); break;

      // ── VEHÍCULOS ──
      case 'getVehiculosActivos':    resultado = getVehiculosActivos(datos.idCliente); break;
      case 'agregarVehiculo':        resultado = agregarVehiculo(datos);               break;
      case 'actualizarVehiculo':      resultado = actualizarVehiculo(datos);                break;
      case 'eliminarVehiculoLogico': resultado = eliminarVehiculoLogico(datos.id);     break;

      // ── HISTORIAL DE SERVICIOS ──
      case 'getHistorialPorVehiculo': resultado = getHistorialPorVehiculo(datos.idVehiculo); break;
      case 'agregarServicio':         resultado = agregarServicio(datos);                     break;
      case 'actualizarServicio':      resultado = actualizarServicio(datos);                  break;
      case 'eliminarServicioLogico':  resultado = eliminarServicioLogico(datos.id);           break;

      default:
        throw new Error(`Acción desconocida: ${action}`);
    }

    output.setContent(JSON.stringify({ ok: true, data: resultado }));

  } catch (err) {
    // Loguea el error en Apps Script (visible en Ver → Registros)
    console.error('doPost error:', err.message);
    output.setContent(JSON.stringify({ ok: false, error: err.message }));
  }

  return output;
}

/**
 * doGet: Responde a peticiones GET (necesario para que la URL funcione
 * como Web App y para verificar que el deploy está activo).
 */
function doGet(e) {
  return ContentService
    .createTextOutput(JSON.stringify({ ok: true, mensaje: 'Taller Dico API activa.' }))
    .setMimeType(ContentService.MimeType.JSON);
}


/* ╔══════════════════════════════════════════════════╗
   ║  UTILIDADES INTERNAS                            ║
   ╚══════════════════════════════════════════════════╝ */

/**
 * Obtiene una hoja por nombre. Lanza error si no existe.
 * @param {string} nombre
 * @returns {GoogleAppsScript.Spreadsheet.Sheet}
 */
function getHoja(nombre) {
  const hoja = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(nombre);
  if (!hoja) throw new Error(`No se encontró la pestaña "${nombre}" en el Sheet.`);
  return hoja;
}

/**
 * Convierte los datos de una hoja en un array de objetos JSON.
 * La primera fila se usa como nombres de clave (encabezados).
 *
 * @param {string} nombreHoja
 * @returns {Array<Object>}
 */
function hojaAJSON(nombreHoja) {
  const hoja   = getHoja(nombreHoja);
  const datos  = hoja.getDataRange().getValues();

  if (datos.length < 2) return []; // Solo encabezado, sin filas

  const encabezados = datos[0]; // Fila 1 = nombres de columnas

  // Convierte cada fila en un objeto { columna: valor }
  return datos.slice(1).map(fila => {
    const obj = {};
    encabezados.forEach((col, i) => {
      // Formatea fechas a string legible
      obj[col] = fila[i] instanceof Date
        ? Utilities.formatDate(fila[i], Session.getScriptTimeZone(), 'dd/MM/yyyy')
        : fila[i];
    });
    return obj;
  });
}

/**
 * Genera un ID correlativo único para la entidad indicada.
 * Cuenta todas las filas existentes (incluyendo eliminadas) para garantizar unicidad.
 *
 * @param {string} nombreHoja - Nombre de la pestaña
 * @param {string} prefix     - Prefijo del ID (ej: 'CLI-', 'VEH-', 'SRV-')
 * @returns {string}           - Ej: 'CLI-007'
 */
function generarId(nombreHoja, prefix) {
  const hoja      = getHoja(nombreHoja);
  const ultimaFila = hoja.getLastRow(); // Incluye el encabezado
  const numero     = ultimaFila; // El ID es = cantidad de filas (encabezado + datos)
  return `${prefix}${String(numero).padStart(3, '0')}`;
}

/**
 * Busca una fila por el valor de su primera columna (ID).
 * Retorna el índice de fila (1-based, para getRange) o -1 si no la encuentra.
 *
 * @param {GoogleAppsScript.Spreadsheet.Sheet} hoja
 * @param {string} id
 * @returns {number} Índice de fila (1-based) o -1
 */
function buscarFilaPorId(hoja, id) {
  const datos = hoja.getDataRange().getValues();
  for (let i = 1; i < datos.length; i++) {
    if (String(datos[i][0]) === String(id)) return i + 1; // +1 porque getRange es 1-based
  }
  return -1;
}

/**
 * Retorna los encabezados (primera fila) de una hoja como array.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} hoja
 * @returns {Array<string>}
 */
function getEncabezados(hoja) {
  return hoja.getRange(1, 1, 1, hoja.getLastColumn()).getValues()[0];
}


/* ╔══════════════════════════════════════════════════╗
   ║  CLIENTES                                       ║
   ╚══════════════════════════════════════════════════╝ */

/**
 * Retorna todos los clientes con Estado = 'Activo'.
 * El frontend solo muestra estos registros; los 'Eliminados' se ocultan (borrado lógico).
 * @returns {Array<Object>}
 */
function getClientesActivos() {
  return hojaAJSON(SHEET_CLIENTES).filter(c => c.Estado === ESTADO_ACTIVO);
}

/**
 * Retorna TODOS los clientes (incluyendo eliminados).
 * Útil para búsquedas por ID y para el panel de administración.
 * @returns {Array<Object>}
 */
function getTodosLosClientes() {
  return hojaAJSON(SHEET_CLIENTES);
}

/**
 * Agrega un nuevo cliente a la hoja.
 * Genera el ID automáticamente y lo marca como 'Activo'.
 *
 * @param {Object} datos - { Nombre, Telefono1, Telefono2, Email }
 * @returns {Object} El cliente recién creado con su ID asignado
 */
function agregarCliente(datos) {
  const hoja = getHoja(SHEET_CLIENTES);
  const id   = generarId(SHEET_CLIENTES, PREFIX_CLIENTE);

  // Orden de columnas: ID_Cliente | Nombre | Telefono | Direccion | Email | Estado
  hoja.appendRow([
    id,
    datos.Nombre    || '',
    datos.Telefono1 || '',
    datos.Telefono2 || '',   // En la hoja es la columna "Direccion"
    datos.Email     || '',
    ESTADO_ACTIVO,
  ]);

  return { ID_Cliente: id, ...datos, Estado: ESTADO_ACTIVO };
}

/**
 * Actualiza los campos de un cliente existente.
 * Busca la fila por ID_Cliente y actualiza columna por columna.
 *
 * @param {Object} datos - { id, Nombre, Telefono1, Telefono2, Email }
 * @returns {boolean}
 */
function actualizarCliente(datos) {
  const hoja      = getHoja(SHEET_CLIENTES);
  const encabezados = getEncabezados(hoja);
  const filaIdx   = buscarFilaPorId(hoja, datos.id);

  if (filaIdx === -1) throw new Error(`Cliente ${datos.id} no encontrado.`);

  // Mapeo frontend → columna del Sheet
  const mapa = {
    Nombre:    'Nombre',
    Telefono1: 'Telefono',
    Telefono2: 'Direccion',
    Email:     'Email',
  };

  Object.entries(mapa).forEach(([campoFrontend, columnaSheet]) => {
    const colIdx = encabezados.indexOf(columnaSheet);
    if (colIdx !== -1 && datos[campoFrontend] !== undefined) {
      hoja.getRange(filaIdx, colIdx + 1).setValue(datos[campoFrontend]);
    }
  });

  return true;
}

/**
 * BORRADO LÓGICO: Cambia Estado a 'Eliminado'.
 * El registro permanece en el Sheet para auditoría y recuperación.
 * NO elimina la fila físicamente.
 *
 * @param {string} id - ID_Cliente
 * @returns {boolean}
 */
function eliminarClienteLogico(id) {
  const hoja      = getHoja(SHEET_CLIENTES);
  const encabezados = getEncabezados(hoja);
  const filaIdx   = buscarFilaPorId(hoja, id);

  if (filaIdx === -1) throw new Error(`Cliente ${id} no encontrado.`);

  const colEstado = encabezados.indexOf('Estado') + 1;
  hoja.getRange(filaIdx, colEstado).setValue(ESTADO_ELIMINADO);

  return true;
}


/* ╔══════════════════════════════════════════════════╗
   ║  VEHÍCULOS                                      ║
   ╚══════════════════════════════════════════════════╝ */

/**
 * Retorna vehículos activos. Si se provee idCliente, filtra por ese cliente.
 *
 * @param {string|null} idCliente
 * @returns {Array<Object>}
 */
function getVehiculosActivos(idCliente = null) {
  let vehiculos = hojaAJSON(SHEET_VEHICULOS).filter(v => v.Estado === ESTADO_ACTIVO);
  if (idCliente) {
    vehiculos = vehiculos.filter(v => v.ID_Cliente === idCliente);
  }
  return vehiculos;
}

/**
 * Agrega un nuevo vehículo a la hoja.
 *
 * @param {Object} datos - { ID_Cliente, Patente, Marca, Modelo, Año, Color }
 * @returns {Object}
 */
function agregarVehiculo(datos) {
  const hoja = getHoja(SHEET_VEHICULOS);
  const id   = generarId(SHEET_VEHICULOS, PREFIX_VEHICULO);

  // Orden de columnas: ID_Vehiculo | ID_Cliente | Patente | Marca | Modelo | Año | Color | Estado
  hoja.appendRow([
    id,
    datos.ID_Cliente || '',
    datos.Patente    || '',
    datos.Marca      || '',
    datos.Modelo     || '',
    datos.Año        || '',
    datos.Color      || '',
    ESTADO_ACTIVO,
  ]);

  return { ID_Vehiculo: id, ...datos, Estado: ESTADO_ACTIVO };
}

/**
 * Actualiza los campos de un vehículo existente.
 * Busca la fila por ID_Vehiculo y actualiza columna por columna.
 *
 * @param {Object} datos - { id, ID_Cliente, Patente, Marca, Modelo, Año, Color }
 * @returns {boolean}
 */
function actualizarVehiculo(datos) {
  const hoja        = getHoja(SHEET_VEHICULOS);
  const encabezados = getEncabezados(hoja);
  const filaIdx     = buscarFilaPorId(hoja, datos.id);

  if (filaIdx === -1) throw new Error(`Vehículo ${datos.id} no encontrado.`);

  // Mapeo campo frontend → nombre de columna en el Sheet
  const mapa = {
    ID_Cliente: 'ID_Cliente',
    Patente:    'Patente',
    Marca:      'Marca',
    Modelo:     'Modelo',
    Año:        'Año',
    Color:      'Color',
  };

  Object.entries(mapa).forEach(([campoFrontend, columnaSheet]) => {
    const colIdx = encabezados.indexOf(columnaSheet);
    if (colIdx !== -1 && datos[campoFrontend] !== undefined && datos[campoFrontend] !== null) {
      hoja.getRange(filaIdx, colIdx + 1).setValue(datos[campoFrontend]);
    }
  });

  return true;
}

/**
 * BORRADO LÓGICO de vehículo.
 * @param {string} id - ID_Vehiculo
 * @returns {boolean}
 */
function eliminarVehiculoLogico(id) {
  const hoja      = getHoja(SHEET_VEHICULOS);
  const encabezados = getEncabezados(hoja);
  const filaIdx   = buscarFilaPorId(hoja, id);

  if (filaIdx === -1) throw new Error(`Vehículo ${id} no encontrado.`);

  const colEstado = encabezados.indexOf('Estado') + 1;
  hoja.getRange(filaIdx, colEstado).setValue(ESTADO_ELIMINADO);

  return true;
}


/* ╔══════════════════════════════════════════════════╗
   ║  HISTORIAL DE SERVICIOS                         ║
   ╚══════════════════════════════════════════════════╝ */

/**
 * Retorna TODOS los registros de servicio de un vehículo (activos y eliminados).
 * El frontend aplica el filtro de Estado='Activo' para el borrado lógico.
 *
 * @param {string} idVehiculo
 * @returns {Array<Object>}
 */
function getHistorialPorVehiculo(idVehiculo) {
  return hojaAJSON(SHEET_HISTORIAL).filter(s => s.ID_Vehiculo === idVehiculo);
}

/**
 * Agrega un nuevo registro de servicio al historial.
 * Genera el ID automáticamente y marca el registro como 'Activo'.
 *
 * @param {Object} datos - { ID_Vehiculo, Fecha, KM, Descripcion_Trabajo, Costo }
 * @returns {Object} El servicio recién creado con su ID
 */
function agregarServicio(datos) {
  const hoja = getHoja(SHEET_HISTORIAL);
  const id   = generarId(SHEET_HISTORIAL, PREFIX_SERVICIO);

  // Formatea la fecha recibida (viene como string 'yyyy-MM-dd' desde el input date)
  let fechaFormateada = datos.Fecha || '';
  if (fechaFormateada && fechaFormateada.includes('-')) {
    // Convierte '2025-03-15' → '15/03/2025' para consistencia con el Sheet
    const [anio, mes, dia] = fechaFormateada.split('-');
    fechaFormateada = `${dia}/${mes}/${anio}`;
  }

  // Orden de columnas: ID_Servicio | ID_Vehiculo | Fecha | KM | Descripcion_Trabajo | Costo | Estado
  hoja.appendRow([
    id,
    datos.ID_Vehiculo          || '',
    fechaFormateada,
    datos.KM                   || '',
    datos.Descripcion_Trabajo  || '',
    datos.Costo                || '',
    ESTADO_ACTIVO,
  ]);

  return {
    ID_Servicio:         id,
    ID_Vehiculo:         datos.ID_Vehiculo,
    Fecha:               fechaFormateada,
    KM:                  datos.KM,
    Descripcion_Trabajo: datos.Descripcion_Trabajo,
    Costo:               datos.Costo,
    Estado:              ESTADO_ACTIVO,
  };
}

/**
 * Actualiza un registro de servicio existente.
 * Solo modifica los campos enviados desde el formulario.
 *
 * @param {Object} datos - { id, ID_Vehiculo, Fecha, KM, Descripcion_Trabajo, Costo }
 * @returns {boolean}
 */
function actualizarServicio(datos) {
  const hoja        = getHoja(SHEET_HISTORIAL);
  const encabezados = getEncabezados(hoja);
  const filaIdx     = buscarFilaPorId(hoja, datos.id);

  if (filaIdx === -1) throw new Error(`Servicio ${datos.id} no encontrado.`);

  // Formatea la fecha si viene en formato ISO
  let fechaFormateada = datos.Fecha || '';
  if (fechaFormateada && fechaFormateada.includes('-')) {
    const [anio, mes, dia] = fechaFormateada.split('-');
    fechaFormateada = `${dia}/${mes}/${anio}`;
  }

  // Mapeo frontend → nombre de columna en el Sheet
  const mapa = {
    Fecha:               'Fecha',
    KM:                  'KM',
    Descripcion_Trabajo: 'Descripcion_Trabajo',
    Costo:               'Costo',
  };

  // Actualiza solo los campos que llegaron en el payload
  Object.entries(mapa).forEach(([campoFrontend, columnaSheet]) => {
    const colIdx = encabezados.indexOf(columnaSheet);
    if (colIdx === -1) return;

    // Usa la fecha formateada para el campo Fecha
    const valor = campoFrontend === 'Fecha' ? fechaFormateada : datos[campoFrontend];
    if (valor !== undefined && valor !== null && valor !== '') {
      hoja.getRange(filaIdx, colIdx + 1).setValue(valor);
    }
  });

  return true;
}

/**
 * BORRADO LÓGICO de servicio: cambia Estado a 'Eliminado'.
 * El registro se conserva en el Sheet para auditoría.
 * El frontend lo filtra y no lo muestra más en el historial.
 *
 * @param {string} id - ID_Servicio
 * @returns {boolean}
 */
function eliminarServicioLogico(id) {
  const hoja        = getHoja(SHEET_HISTORIAL);
  const encabezados = getEncabezados(hoja);
  const filaIdx     = buscarFilaPorId(hoja, id);

  if (filaIdx === -1) throw new Error(`Servicio ${id} no encontrado.`);

  const colEstado = encabezados.indexOf('Estado') + 1;
  if (colEstado === 0) throw new Error('No se encontró la columna "Estado" en Historial.');

  hoja.getRange(filaIdx, colEstado).setValue(ESTADO_ELIMINADO);

  return true;
}


/* ╔══════════════════════════════════════════════════╗
   ║  FUNCIÓN DE PRUEBA (opcional)                   ║
   ╚══════════════════════════════════════════════════╝ */

/**
 * Ejecutá esta función desde el editor de Apps Script para
 * verificar que todo está conectado correctamente.
 * Menú: Ejecutar → testConexion
 */
function testConexion() {
  try {
    const clientes  = getClientesActivos();
    const vehiculos = getVehiculosActivos();
    const historial = hojaAJSON(SHEET_HISTORIAL);

    console.log(`✅ Clientes activos: ${clientes.length}`);
    console.log(`✅ Vehículos activos: ${vehiculos.length}`);
    console.log(`✅ Registros de historial: ${historial.length}`);
    console.log('✅ Conexión con el Sheet OK');
  } catch (err) {
    console.error('❌ Error:', err.message);
  }
}
