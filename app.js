/**
 * TALLERPRO — Sistema de Gestión
 * app.js (ES6+ Módulo principal)
 *
 * Arquitectura:
 *  ┌─────────────────────────────────────────────────┐
 *  │  API        →  capa de comunicación con GAS     │
 *  │  DataStore  →  servicios de datos (vía API)     │
 *  │  UI         →  renderizado de vistas            │
 *  │  Modal      →  apertura/cierre de modales       │
 *  │  Toast      →  notificaciones temporales        │
 *  │  App        →  inicialización y event binding   │
 *  └─────────────────────────────────────────────────┘
 *
 * Conexión con Google Apps Script:
 *  1. Desplegá Code.gs como Web App en tu Google Sheet
 *     (Extensiones → Apps Script → Implementar → Nueva implementación)
 *  2. Copiá la URL del despliegue y pegala en GAS_URL (abajo)
 *  3. Asegurate de dar acceso a "Cualquier usuario" en la configuración
 */

'use strict';


/* ╔══════════════════════════════════════════════════╗
   ║  CONFIGURACIÓN DE LA API                        ║
   ╚══════════════════════════════════════════════════╝ */

/**
 * URL de la Web App de Google Apps Script.
 * Reemplazá este valor con la URL que obtenés al desplegar Code.gs.
 *
 * Ejemplo:
 *  'https://script.google.com/macros/s/AKfycbxxxxxxx.../exec'
 *
 * ⚠️  IMPORTANTE: No compartas esta URL públicamente si tu hoja
 *     contiene datos sensibles.
 */
const GAS_URL = 'https://script.google.com/macros/s/AKfycbxLbPSoiOpE_iI8uBKirPzHaxKAc6YkVQBD1FqOCg_-a2QAY4498yDovX4cja3Rq5cw/exec';


/* ╔══════════════════════════════════════════════════╗
   ║  CAPA DE COMUNICACIÓN CON GOOGLE APPS SCRIPT    ║
   ║  Todas las llamadas al backend pasan por aquí.  ║
   ╚══════════════════════════════════════════════════╝ */

/**
 * API: Objeto que centraliza las peticiones fetch a la Web App de GAS.
 *
 * Todas las funciones son async y retornan el campo `data` de la
 * respuesta en caso de éxito, o lanzan un Error en caso de fallo.
 *
 * El backend (Code.gs) siempre responde con:
 *  { ok: true,  data: <resultado> }  ← Éxito
 *  { ok: false, error: <mensaje>  }  ← Error controlado
 */
const API = {

  /**
   * Realiza una petición POST al endpoint de Google Apps Script.
   * Serializa la acción y los datos en el body como JSON.
   *
   * @param {string} action  - Nombre de la acción (debe coincidir con el switch en Code.gs)
   * @param {Object} [datos] - Datos adicionales a enviar (opcionales)
   * @returns {Promise<*>} El campo `data` de la respuesta
   * @throws {Error} Si la red falla o el servidor devuelve ok: false
   */
  async llamar(action, datos = {}) {
    const res = await fetch(GAS_URL, {
      method: 'POST',
      // GAS no acepta application/json directamente en algunos casos;
      // text/plain evita el preflight CORS y funciona con doPost(e)
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, datos }),
    });

    if (!res.ok) {
      throw new Error(`Error HTTP ${res.status}: ${res.statusText}`);
    }

    const json = await res.json();

    if (!json.ok) {
      throw new Error(json.error || 'Error desconocido en el servidor.');
    }

    return json.data;
  },

  /* ── CLIENTES ── */

  /** @returns {Promise<Array<Object>>} Clientes con Estado = 'Activo' */
  getClientesActivos()              { return this.llamar('getClientesActivos'); },

  /** @returns {Promise<Array<Object>>} Todos los clientes (incluyendo eliminados) */
  getTodosLosClientes()             { return this.llamar('getTodosLosClientes'); },

  /**
   * @param {Object} datos - { Nombre, Telefono1, Telefono2, Email }
   * @returns {Promise<Object>} El cliente recién creado con su ID
   */
  agregarCliente(datos)             { return this.llamar('agregarCliente', datos); },

  /**
   * @param {string} id
   * @param {Object} datos - Campos a actualizar
   * @returns {Promise<boolean>}
   */
  actualizarCliente(id, datos)      { return this.llamar('actualizarCliente', { id, ...datos }); },

  /**
   * Borrado lógico: cambia Estado a 'Eliminado' en el Sheet.
   * @param {string} id
   * @returns {Promise<boolean>}
   */
  eliminarClienteLogico(id)         { return this.llamar('eliminarClienteLogico', { id }); },

  /* ── VEHÍCULOS ── */

  /**
   * @param {string|null} [idCliente] - Filtra por cliente si se provee
   * @returns {Promise<Array<Object>>}
   */
  getVehiculosActivos(idCliente = null) {
    return this.llamar('getVehiculosActivos', { idCliente });
  },

  /**
   * @param {Object} datos - { ID_Cliente, Patente, Marca, Modelo, Año, Color }
   * @returns {Promise<Object>}
   */
  agregarVehiculo(datos)            { return this.llamar('agregarVehiculo', datos); },

  /**
   * @param {string} id
   * @returns {Promise<boolean>}
   */
  eliminarVehiculoLogico(id)        { return this.llamar('eliminarVehiculoLogico', { id }); },

  /* ── HISTORIAL ── */

  /**
   * @param {string} idVehiculo
   * @returns {Promise<Array<Object>>}
   */
  getHistorialPorVehiculo(idVehiculo) {
    return this.llamar('getHistorialPorVehiculo', { idVehiculo });
  },
};


/* ╔══════════════════════════════════════════════════╗
   ║  CACHE LOCAL (optimización de rendimiento)      ║
   ║  Evita llamadas repetidas al Sheet en la misma  ║
   ║  sesión. Se invalida al modificar datos.        ║
   ╚══════════════════════════════════════════════════╝ */

/**
 * Cache: Almacena temporalmente los datos traídos del Sheet.
 * Al crear, actualizar o eliminar, se limpia la entrada correspondiente.
 */
const Cache = {
  _store: {},

  /** Guarda un valor en caché con su clave */
  set(clave, valor) { this._store[clave] = valor; },

  /** Recupera un valor; retorna null si no existe */
  get(clave)        { return this._store[clave] ?? null; },

  /** Invalida una entrada específica del caché */
  invalidar(clave)  { delete this._store[clave]; },

  /** Limpia todo el caché (útil al detectar errores de sincronización) */
  limpiar()         { this._store = {}; },
};


/* ╔══════════════════════════════════════════════════╗
   ║  CAPA DE DATOS (DataStore)                      ║
   ║  Todas las operaciones CRUD pasan por aquí.     ║
   ║  Ahora es async: cada método devuelve Promise.  ║
   ╚══════════════════════════════════════════════════╝ */

/**
 * DataStore: Objeto singleton que encapsula toda la
 * lógica de acceso y mutación de datos.
 *
 * Cambio respecto a la versión mock:
 *  - Todos los métodos son ahora async/await
 *  - Usan API.* en lugar de arrays locales
 *  - Incorporan caché para reducir llamadas al Sheet
 */
const DataStore = {

  /* ── CLIENTES ── */

  /**
   * Retorna solo los clientes con Estado = 'Activo'.
   * Usa caché para evitar llamadas repetidas en la misma sesión.
   * @returns {Promise<Array<Object>>}
   */
  async getClientesActivos() {
    if (!Cache.get('clientesActivos')) {
      const clientes = await API.getClientesActivos();
      Cache.set('clientesActivos', clientes);
    }
    return Cache.get('clientesActivos');
  },

  /**
   * Retorna todos los clientes (incluyendo eliminados).
   * @returns {Promise<Array<Object>>}
   */
  async getTodosLosClientes() {
    return API.getTodosLosClientes();
  },

  /**
   * Busca un cliente por ID en el caché local.
   * Si el caché no existe, lo carga primero.
   * @param {string} id
   * @returns {Promise<Object|undefined>}
   */
  async getClientePorId(id) {
    const clientes = await this.getTodosLosClientes();
    return clientes.find(c => c.ID_Cliente === id);
  },

  /**
   * Agrega un nuevo cliente al Sheet.
   * Invalida el caché de clientes para forzar recarga.
   * @param {Object} datosCliente - { Nombre, Telefono1, Telefono2, Email }
   * @returns {Promise<Object>} El cliente recién creado
   */
  async agregarCliente(datosCliente) {
    const nuevo = await API.agregarCliente(datosCliente);
    // Invalidamos el caché para que la próxima lectura traiga datos frescos
    Cache.invalidar('clientesActivos');
    return nuevo;
  },

  /**
   * Actualiza los datos de un cliente existente en el Sheet.
   * @param {string} id
   * @param {Object} datosActualizados
   * @returns {Promise<boolean>}
   */
  async actualizarCliente(id, datosActualizados) {
    const resultado = await API.actualizarCliente(id, datosActualizados);
    Cache.invalidar('clientesActivos');
    return resultado;
  },

  /**
   * Borrado lógico: cambia Estado a 'Eliminado' en el Sheet.
   * @param {string} id
   * @returns {Promise<boolean>}
   */
  async eliminarClienteLogico(id) {
    const resultado = await API.eliminarClienteLogico(id);
    Cache.invalidar('clientesActivos');
    return resultado;
  },

  /* ── VEHÍCULOS ── */

  /**
   * Retorna vehículos activos, opcionalmente filtrados por ID de cliente.
   * @param {string|null} [idCliente]
   * @returns {Promise<Array<Object>>}
   */
  async getVehiculosActivos(idCliente = null) {
    // La clave de caché incluye el filtro para no mezclar resultados
    const clave = `vehiculosActivos_${idCliente || 'todos'}`;
    if (!Cache.get(clave)) {
      const vehiculos = await API.getVehiculosActivos(idCliente);
      Cache.set(clave, vehiculos);
    }
    return Cache.get(clave);
  },

  /**
   * Agrega un vehículo nuevo al Sheet.
   * @param {Object} datos - { ID_Cliente, Patente, Marca, Modelo, Año, Color }
   * @returns {Promise<Object>}
   */
  async agregarVehiculo(datos) {
    const nuevo = await API.agregarVehiculo(datos);
    // Invalidamos todas las entradas de vehículos en caché
    Cache.invalidar('vehiculosActivos_todos');
    Cache.invalidar(`vehiculosActivos_${datos.ID_Cliente}`);
    return nuevo;
  },

  /**
   * Borrado lógico de un vehículo.
   * @param {string} id
   * @returns {Promise<boolean>}
   */
  async eliminarVehiculoLogico(id) {
    const resultado = await API.eliminarVehiculoLogico(id);
    Cache.limpiar(); // Limpiamos todo el caché de vehículos por seguridad
    return resultado;
  },

  /* ── HISTORIAL ── */

  /**
   * Retorna los servicios activos de un vehículo.
   * @param {string} idVehiculo
   * @returns {Promise<Array<Object>>}
   */
  async getHistorialPorVehiculo(idVehiculo) {
    return API.getHistorialPorVehiculo(idVehiculo);
  },
};


/* ╔══════════════════════════════════════════════════╗
   ║  CAPA DE UI (Renderizado)                       ║
   ╚══════════════════════════════════════════════════╝ */

/**
 * UI: Objeto con todas las funciones de renderizado DOM.
 * Nunca accede a los datos directamente; usa DataStore.
 *
 * Cambio respecto a la versión mock:
 *  - Los métodos que leen datos son ahora async
 *  - Muestran un spinner mientras cargan desde el Sheet
 */
const UI = {

  /* ── CLIENTES ── */

  /**
   * Renderiza la tabla de clientes filtrando por el término de búsqueda.
   * Solo muestra registros con Estado = 'Activo'.
   * @param {string} [filtro=''] - Término de búsqueda (por nombre)
   */
  async renderizarTablaClientes(filtro = '') {
    const tbody   = document.getElementById('tbodyClientes');
    const emptyEl = document.getElementById('emptyClientes');
    const countEl = document.getElementById('countClientes');

    // Muestra indicador de carga mientras esperamos el Sheet
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-muted)">Cargando...</td></tr>';

    try {
      // Filtra por nombre (case-insensitive) y solo Activos
      const clientes = (await DataStore.getClientesActivos()).filter(c =>
        c.Nombre.toLowerCase().includes(filtro.toLowerCase())
      );

      // Limpia el contenido previo de la tabla
      tbody.innerHTML = '';

      if (clientes.length === 0) {
        // Muestra mensaje vacío y oculta la tabla
        emptyEl.hidden = false;
        countEl.textContent = '0 registros';
        return;
      }

      emptyEl.hidden = true;
      countEl.textContent = `${clientes.length} registro${clientes.length !== 1 ? 's' : ''}`;

      // Construye las filas de forma eficiente con DocumentFragment
      const fragment = document.createDocumentFragment();

      clientes.forEach(cliente => {
        const tr = document.createElement('tr');
        // Almacenamos el ID en el dataset para recuperarlo en el doble clic
        tr.dataset.id = cliente.ID_Cliente;
        tr.title = 'Doble clic para ver detalles';
        tr.innerHTML = `
          <td style="color: var(--text-muted); font-size: 0.75rem;">${cliente.ID_Cliente}</td>
          <td style="font-weight: 500;">${escapeHtml(cliente.Nombre)}</td>
          <td>${escapeHtml(cliente.Telefono)}</td>
          <td>${escapeHtml(cliente.Direccion) || '<span style="color:var(--text-muted)">—</span>'}</td>
          <td>${escapeHtml(cliente.Email) || '<span style="color:var(--text-muted)">—</span>'}</td>
          
        `;
        // Evento de doble clic para abrir la ficha completa
        tr.addEventListener('dblclick', () => App.abrirDetalleCliente(cliente.ID_Cliente));
        fragment.appendChild(tr);
      });

      tbody.appendChild(fragment);

      // Reiniciamos los íconos de Lucide para las filas nuevas
      lucide.createIcons();

    } catch (err) {
      // Error al cargar datos del Sheet: mostramos mensaje en la tabla
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--danger)">
        Error al cargar datos: ${escapeHtml(err.message)}
      </td></tr>`;
      console.error('renderizarTablaClientes:', err);
    }
  },

  /**
   * Renderiza la tabla de vehículos con filtro de búsqueda.
   * @param {string} [filtro='']
   */
  async renderizarTablaVehiculos(filtro = '') {
    const tbody   = document.getElementById('tbodyVehiculos');
    const emptyEl = document.getElementById('emptyVehiculos');
    const countEl = document.getElementById('countVehiculos');

    // Muestra indicador de carga mientras esperamos el Sheet
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--text-muted)">Cargando...</td></tr>';

    try {
      const termino  = filtro.toLowerCase();
      const vehiculos = (await DataStore.getVehiculosActivos()).filter(v =>
        v.Patente.toLowerCase().includes(termino) ||
        v.Marca.toLowerCase().includes(termino)   ||
        v.Modelo.toLowerCase().includes(termino)
      );

      tbody.innerHTML = '';

      if (vehiculos.length === 0) {
        emptyEl.hidden = false;
        countEl.textContent = '0 registros';
        return;
      }

      emptyEl.hidden = true;
      countEl.textContent = `${vehiculos.length} registro${vehiculos.length !== 1 ? 's' : ''}`;

      const fragment = document.createDocumentFragment();

      // Cargamos todos los clientes una sola vez para hacer el join en memoria
      const todosLosClientes = await DataStore.getClientesActivos();

      vehiculos.forEach(v => {
        // Buscamos el nombre del cliente para mostrar en la tabla
        const cliente = todosLosClientes.find(c => c.ID_Cliente === v.ID_Cliente);
        const nombreCliente = cliente ? escapeHtml(cliente.Nombre) : 'Desconocido';

        const tr = document.createElement('tr');
        tr.dataset.id = v.ID_Vehiculo;
        tr.innerHTML = `
          <td style="color: var(--text-muted); font-size: 0.75rem;">${v.ID_Vehiculo}</td>
          <td style="font-weight: 600; letter-spacing: 0.04em;">${escapeHtml(v.Patente)}</td>
          <td>${escapeHtml(v.Marca)}</td>
          <td>${escapeHtml(v.Modelo)}</td>
          <td>${v.Año || '—'}</td>
          <td>${escapeHtml(v.Color) || '—'}</td>
          <td>${nombreCliente}</td>
          <td>${UI.badgeEstado(v.Estado)}</td>
        `;
        fragment.appendChild(tr);
      });

      tbody.appendChild(fragment);
      lucide.createIcons();

    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;color:var(--danger)">
        Error al cargar datos: ${escapeHtml(err.message)}
      </td></tr>`;
      console.error('renderizarTablaVehiculos:', err);
    }
  },

  /**
   * Rellena la sub-tabla de vehículos dentro del modal de detalle.
   * @param {string} idCliente
   */
  async renderizarVehiculosDeCliente(idCliente) {
    const tbody   = document.getElementById('tbodyVehiculosCliente');
    const emptyEl = document.getElementById('emptyVehiculosCliente');

    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-muted)">Cargando...</td></tr>';

    try {
      // Solo vehículos activos vinculados a este cliente
      const vehiculos = await DataStore.getVehiculosActivos(idCliente);

      tbody.innerHTML = '';

      if (vehiculos.length === 0) {
        emptyEl.hidden = false;
        return;
      }

      emptyEl.hidden = true;
      const fragment = document.createDocumentFragment();

      vehiculos.forEach(v => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td style="font-weight: 600;">${escapeHtml(v.Patente)}</td>
          <td>${escapeHtml(v.Marca)}</td>
          <td>${escapeHtml(v.Modelo)}</td>
          <td>${v.Año || '—'}</td>
          <td>${escapeHtml(v.Color) || '—'}</td>
        `;
        fragment.appendChild(tr);
      });

      tbody.appendChild(fragment);

    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="5" style="color:var(--danger)">${escapeHtml(err.message)}</td></tr>`;
    }
  },

  /**
   * Muestra la ficha detallada de un cliente en el modal de detalles.
   * @param {Object} cliente
   */
  renderizarFichaCliente(cliente) {
    const fichaEl = document.getElementById('fichaCliente');
    fichaEl.innerHTML = `
      <div class="client-card__field">
        <span class="client-card__label">ID</span>
        <span class="client-card__value" style="font-family: monospace; color: var(--text-secondary);">${cliente.ID_Cliente}</span>
      </div>
      <div class="client-card__field">
        <span class="client-card__label">Nombre</span>
        <span class="client-card__value">${escapeHtml(cliente.Nombre)}</span>
      </div>
      <div class="client-card__field">
        <span class="client-card__label">Teléfono 1</span>
        <span class="client-card__value">${escapeHtml(cliente.Telefono) || '—'}</span>
      </div>
      <div class="client-card__field">
        <span class="client-card__label">Teléfono 2</span>
        <span class="client-card__value">${escapeHtml(cliente.Direccion) || '—'}</span>
      </div>
      <div class="client-card__field">
        <span class="client-card__label">Email</span>
        <span class="client-card__value">${escapeHtml(cliente.Email) || '—'}</span>
      </div>
    `;
  },

  /**
   * Puebla el select de clientes en el formulario de vehículo.
   * Solo muestra clientes activos.
   */
  async poblarSelectClientes() {
    const select = document.getElementById('inputClienteVehiculo');

    // Muestra un estado de carga en el select mientras espera
    select.innerHTML = '<option value="">Cargando clientes...</option>';
    select.disabled = true;

    try {
      const clientes = await DataStore.getClientesActivos();

      // Limpia opciones y restaura el placeholder
      select.innerHTML = '<option value="">— Seleccionar cliente —</option>';

      clientes.forEach(c => {
        const option = document.createElement('option');
        option.value = c.ID_Cliente;
        option.textContent = `${c.Nombre} (${c.ID_Cliente})`;
        select.appendChild(option);
      });

    } catch (err) {
      select.innerHTML = '<option value="">Error al cargar clientes</option>';
      mostrarToast('No se pudo cargar la lista de clientes.', 'error');
    } finally {
      // Siempre rehabilitamos el select, sin importar si hubo error
      select.disabled = false;
    }
  },

  /**
   * Genera el HTML de un badge de estado con color semántico.
   * @param {string} estado - 'Activo' o 'Eliminado'
   * @returns {string} HTML del badge
   */
  badgeEstado(estado) {
    const clase = estado === 'Activo' ? 'badge--activo' : 'badge--eliminado';
    return `<span class="badge ${clase}">${escapeHtml(estado)}</span>`;
  },
};


/* ╔══════════════════════════════════════════════════╗
   ║  GESTIÓN DE MODALES                             ║
   ╚══════════════════════════════════════════════════╝ */

/**
 * Modal: funciones de apertura y cierre de diálogos.
 */
const Modal = {

  /**
   * Muestra un modal por su ID y bloquea el scroll del body.
   * @param {string} id - ID del elemento .modal-overlay
   */
  abrir(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.hidden = false;
    document.body.style.overflow = 'hidden';
    // Enfoca el primer input para accesibilidad
    setTimeout(() => {
      const primerInput = el.querySelector('input:not([type="hidden"]), select');
      if (primerInput) primerInput.focus();
    }, 100);
  },

  /**
   * Oculta un modal por su ID y restaura el scroll.
   * @param {string} id
   */
  cerrar(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.hidden = true;
    document.body.style.overflow = '';
  },

  /**
   * Resetea los campos de un formulario dentro de un modal.
   * @param {string} formId
   */
  limpiarFormulario(formId) {
    const form = document.getElementById(formId);
    if (form) {
      form.reset();
      // Elimina cualquier clase de error previa
      form.querySelectorAll('.error').forEach(el => el.classList.remove('error'));
    }
  },
};


/* ╔══════════════════════════════════════════════════╗
   ║  SISTEMA DE NOTIFICACIONES (Toast)              ║
   ╚══════════════════════════════════════════════════╝ */

/**
 * Muestra una notificación temporal en la esquina inferior derecha.
 * @param {string} mensaje  - Texto a mostrar
 * @param {'success'|'error'|'info'} tipo - Tipo de notificación
 * @param {number} [duracion=3000] - Tiempo en ms antes de desaparecer
 */
function mostrarToast(mensaje, tipo = 'info', duracion = 3000) {
  const container = document.getElementById('toastContainer');

  // Ícono según el tipo de toast
  const iconos = {
    success: 'check-circle-2',
    error:   'x-circle',
    info:    'info',
  };

  const toast = document.createElement('div');
  toast.className = `toast toast--${tipo}`;
  toast.innerHTML = `<i data-lucide="${iconos[tipo] || 'info'}"></i> ${escapeHtml(mensaje)}`;
  container.appendChild(toast);

  // Renderiza el ícono SVG de Lucide
  lucide.createIcons({ nodes: [toast] });

  // Elimina el elemento del DOM después de que la animación termina
  setTimeout(() => toast.remove(), duracion + 400);
}


/* ╔══════════════════════════════════════════════════╗
   ║  NAVEGACIÓN SPA                                 ║
   ╚══════════════════════════════════════════════════╝ */

/**
 * Cambia la sección visible sin recargar la página.
 * @param {string} seccion - 'clientes' o 'vehiculos'
 */
function navegarA(seccion) {
  // Oculta todas las secciones
  document.querySelectorAll('.section').forEach(s => s.classList.add('hidden'));

  // Muestra la sección seleccionada
  const target = document.getElementById(`section-${seccion}`);
  if (target) {
    target.classList.remove('hidden');
    // Refresca el contenido de la sección activa
    if (seccion === 'clientes')  UI.renderizarTablaClientes();
    if (seccion === 'vehiculos') UI.renderizarTablaVehiculos();
  }

  // Actualiza el estado activo de los botones del menú
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.section === seccion);
    btn.setAttribute('aria-current', btn.dataset.section === seccion ? 'page' : 'false');
  });
}


/* ╔══════════════════════════════════════════════════╗
   ║  LÓGICA DE NEGOCIO (App)                        ║
   ╚══════════════════════════════════════════════════╝ */

/**
 * App: Controlador principal que une DataStore, UI y Modal.
 * Aquí se definen las acciones de usuario.
 *
 * Cambio respecto a la versión mock:
 *  - Todos los métodos que modifican datos son async
 *  - Muestran toast de carga y manejan errores de red
 */
const App = {

  /** ID del cliente seleccionado actualmente en el modal de detalles */
  clienteActivoId: null,

  /* ── CLIENTES ── */

  /**
   * Guarda un cliente nuevo o actualiza uno existente.
   * Lee los datos del formulario #formCliente.
   * @param {Event} e - Evento submit del formulario
   */
  async guardarCliente(e) {
    e.preventDefault();
    const idInput = document.getElementById('inputClienteId');

    // Extrae y limpia los datos del formulario
    const datos = {
      Nombre:    document.getElementById('inputNombre').value.trim(),
      Telefono1: document.getElementById('inputTel1').value.trim(),
      Telefono2: document.getElementById('inputTel2').value.trim(),
      Email:     document.getElementById('inputEmail').value.trim(),
    };

    // Validación básica: campos requeridos
    if (!datos.Nombre || !datos.Telefono1) {
      mostrarToast('Por favor completá los campos obligatorios.', 'error');
      if (!datos.Nombre)    document.getElementById('inputNombre').classList.add('error');
      if (!datos.Telefono1) document.getElementById('inputTel1').classList.add('error');
      return;
    }

    const esEdicion = idInput.value !== '';

    try {
      // Deshabilita el botón submit para evitar doble envío
      const btnSubmit = document.querySelector('#formCliente [type="submit"]');
      if (btnSubmit) { btnSubmit.disabled = true; btnSubmit.textContent = 'Guardando...'; }

      if (esEdicion) {
        // ── MODO EDICIÓN ──
        await DataStore.actualizarCliente(idInput.value, datos);
        mostrarToast('Cliente actualizado correctamente.', 'success');
      } else {
        // ── MODO CREACIÓN ──
        await DataStore.agregarCliente(datos);
        mostrarToast('Cliente agregado exitosamente.', 'success');
      }

      // Cierra el modal, limpia el form y refresca la tabla
      Modal.cerrar('modalCliente');
      Modal.limpiarFormulario('formCliente');
      UI.renderizarTablaClientes(document.getElementById('searchClientes').value);

    } catch (err) {
      // Error de red o del servidor: informamos al usuario
      mostrarToast(`Error al guardar: ${err.message}`, 'error');
      console.error('guardarCliente:', err);
    } finally {
      // Siempre rehabilitamos el botón
      const btnSubmit = document.querySelector('#formCliente [type="submit"]');
      if (btnSubmit) { btnSubmit.disabled = false; btnSubmit.textContent = 'Guardar'; }
    }
  },

  /**
   * Prepara y abre el modal para EDITAR un cliente existente.
   * Pre-rellena los campos del formulario con los datos actuales.
   * @param {string} idCliente
   */
  async abrirEdicionCliente(idCliente) {
    const cliente = await DataStore.getClientePorId(idCliente);
    if (!cliente) return;

    // Pre-rellena el formulario
    document.getElementById('inputClienteId').value  = cliente.ID_Cliente;
    document.getElementById('inputNombre').value     = cliente.Nombre;
    document.getElementById('inputTel1').value       = cliente.Telefono1;
    document.getElementById('inputTel2').value       = cliente.Telefono2;
    document.getElementById('inputEmail').value      = cliente.Email;

    // Cambia el título del modal al modo edición
    document.getElementById('modalClienteTitle').textContent = 'Editar Cliente';

    Modal.cerrar('modalDetalleCliente');
    Modal.abrir('modalCliente');
  },

  /**
   * Abre el modal de detalles de un cliente.
   * Muestra su ficha y sus vehículos asociados.
   * @param {string} idCliente
   */
  async abrirDetalleCliente(idCliente) {
    const cliente = await DataStore.getClientePorId(idCliente);
    if (!cliente) return;

    // Guarda referencia al cliente activo para acciones del modal
    App.clienteActivoId = idCliente;

    UI.renderizarFichaCliente(cliente);
    UI.renderizarVehiculosDeCliente(idCliente); // No necesita await; actualiza el DOM sola

    document.getElementById('modalDetalleTitle').textContent = `Ficha: ${cliente.Nombre}`;
    Modal.abrir('modalDetalleCliente');
    lucide.createIcons();
  },

  /**
   * Elimina lógicamente al cliente activo en el modal de detalles.
   * Pide confirmación antes de proceder.
   */
  async eliminarClienteActivo() {
    if (!App.clienteActivoId) return;

    const cliente = await DataStore.getClientePorId(App.clienteActivoId);
    if (!cliente) return;

    // Confirmación del usuario antes de marcar como eliminado
    const confirmar = window.confirm(
      `¿Estás seguro de que querés eliminar a "${cliente.Nombre}"?\nEsta acción se puede revertir cambiando el Estado a "Activo" directamente en el Sheet.`
    );

    if (!confirmar) return;

    try {
      await DataStore.eliminarClienteLogico(App.clienteActivoId);
      Modal.cerrar('modalDetalleCliente');
      UI.renderizarTablaClientes(document.getElementById('searchClientes').value);
      mostrarToast(`Cliente "${cliente.Nombre}" eliminado.`, 'info');
      App.clienteActivoId = null;
    } catch (err) {
      mostrarToast(`Error al eliminar: ${err.message}`, 'error');
      console.error('eliminarClienteActivo:', err);
    }
  },

  /* ── VEHÍCULOS ── */

  /**
   * Guarda un vehículo nuevo desde el formulario.
   * @param {Event} e
   */
  async guardarVehiculo(e) {
    e.preventDefault();

    const datos = {
      ID_Cliente: document.getElementById('inputClienteVehiculo').value,
      Patente:    document.getElementById('inputPatente').value.trim().toUpperCase(),
      Marca:      document.getElementById('inputMarca').value.trim(),
      Modelo:     document.getElementById('inputModelo').value.trim(),
      Año:        parseInt(document.getElementById('inputAnio').value, 10) || null,
      Color:      document.getElementById('inputColor').value.trim(),
    };

    // Validación básica
    if (!datos.Patente || !datos.Marca || !datos.Modelo || !datos.ID_Cliente) {
      mostrarToast('Completá todos los campos obligatorios.', 'error');
      return;
    }

    try {
      // Deshabilita el botón submit para evitar doble envío
      const btnSubmit = document.querySelector('#formVehiculo [type="submit"]');
      if (btnSubmit) { btnSubmit.disabled = true; btnSubmit.textContent = 'Guardando...'; }

      await DataStore.agregarVehiculo(datos);
      Modal.cerrar('modalVehiculo');
      Modal.limpiarFormulario('formVehiculo');
      UI.renderizarTablaVehiculos(document.getElementById('searchVehiculos').value);
      mostrarToast('Vehículo registrado correctamente.', 'success');

    } catch (err) {
      mostrarToast(`Error al guardar vehículo: ${err.message}`, 'error');
      console.error('guardarVehiculo:', err);
    } finally {
      const btnSubmit = document.querySelector('#formVehiculo [type="submit"]');
      if (btnSubmit) { btnSubmit.disabled = false; btnSubmit.textContent = 'Guardar'; }
    }
  },
};


/* ╔══════════════════════════════════════════════════╗
   ║  UTILIDADES                                     ║
   ╚══════════════════════════════════════════════════╝ */

/**
 * Escapa caracteres HTML para prevenir XSS.
 * Siempre sanitizar el input del usuario antes de insertar en el DOM.
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;')
    .replace(/'/g,  '&#039;');
}

/**
 * Retorna una función que retrasa la ejecución de fn
 * hasta que hayan pasado `espera` ms sin llamadas.
 * Útil para la búsqueda en tiempo real sin saturar llamadas al Sheet.
 * @param {Function} fn
 * @param {number} espera - ms
 * @returns {Function}
 */
function debounce(fn, espera = 250) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), espera);
  };
}


/* ╔══════════════════════════════════════════════════╗
   ║  INICIALIZACIÓN                                 ║
   ║  Corre al cargar el módulo (DOMContentLoaded)   ║
   ╚══════════════════════════════════════════════════╝ */

/**
 * Punto de entrada de la aplicación.
 * Registra todos los event listeners.
 */
function init() {

  // Inicializar íconos SVG de Lucide
  lucide.createIcons();

  // ── NAVEGACIÓN ──
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => navegarA(btn.dataset.section));
  });

  // ── BÚSQUEDA EN TIEMPO REAL ──
  // Usamos debounce para no disparar una llamada al Sheet en cada tecla
  const buscarClientes  = debounce(e => UI.renderizarTablaClientes(e.target.value), 400);
  const buscarVehiculos = debounce(e => UI.renderizarTablaVehiculos(e.target.value), 400);

  document.getElementById('searchClientes')?.addEventListener('input', buscarClientes);
  document.getElementById('searchVehiculos')?.addEventListener('input', buscarVehiculos);

  // ── BOTÓN: AGREGAR CLIENTE ──
  document.getElementById('btnAgregarCliente')?.addEventListener('click', () => {
    Modal.limpiarFormulario('formCliente');
    document.getElementById('inputClienteId').value = '';
    document.getElementById('modalClienteTitle').textContent = 'Nuevo Cliente';
    Modal.abrir('modalCliente');
  });

  // ── FORMULARIO: GUARDAR CLIENTE ──
  // App.guardarCliente es async; el evento submit lo invoca normalmente
  document.getElementById('formCliente')?.addEventListener('submit', App.guardarCliente);

  // Limpia el estilo de error al escribir en los inputs
  document.querySelectorAll('#formCliente input').forEach(input => {
    input.addEventListener('input', () => input.classList.remove('error'));
  });

  // ── MODAL DE DETALLES: BOTONES DE ACCIÓN ──
  document.getElementById('btnEditarClienteDetalle')?.addEventListener('click', () => {
    if (App.clienteActivoId) App.abrirEdicionCliente(App.clienteActivoId);
  });

  document.getElementById('btnEliminarClienteDetalle')?.addEventListener('click',
    App.eliminarClienteActivo
  );

  // ── BOTÓN: AGREGAR VEHÍCULO ──
  document.getElementById('btnAgregarVehiculo')?.addEventListener('click', () => {
    Modal.limpiarFormulario('formVehiculo');
    document.getElementById('inputVehiculoId').value = '';
    UI.poblarSelectClientes(); // Refresca el select de clientes cada vez (async)
    Modal.abrir('modalVehiculo');
  });

  // ── FORMULARIO: GUARDAR VEHÍCULO ──
  document.getElementById('formVehiculo')?.addEventListener('submit', App.guardarVehiculo);

  // ── CIERRE DE MODALES ──
  // Botones con atributo data-close="<id-modal>"
  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => Modal.cerrar(btn.dataset.close));
  });

  // Cierre al hacer clic en el overlay (fondo oscuro)
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', e => {
      // Solo cierra si el clic fue directamente sobre el overlay, no en su interior
      if (e.target === overlay) Modal.cerrar(overlay.id);
    });
  });

  // Cierre con tecla Escape
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    // Cierra el primer modal visible que encuentre
    const modalAbierto = document.querySelector('.modal-overlay:not([hidden])');
    if (modalAbierto) Modal.cerrar(modalAbierto.id);
  });

  // ── RENDERIZADO INICIAL ──
  navegarA('clientes');

  console.info('TallerPro iniciado. Conectado a Google Apps Script →', GAS_URL);
}

// Espera a que el DOM esté completamente cargado
document.addEventListener('DOMContentLoaded', init);