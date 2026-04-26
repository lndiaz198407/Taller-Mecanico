/**
 * TALLER DICO — Sistema de Gestión
 * app.js (ES6+ Módulo principal) — v2.0 con Historial de Servicios
 *
 * Arquitectura:
 *  ┌─────────────────────────────────────────────────────┐
 *  │  API        →  capa de comunicación con GAS         │
 *  │  Cache      →  caché en memoria por sesión          │
 *  │  DataStore  →  servicios de datos (vía API/cache)   │
 *  │  UI         →  renderizado de vistas y tablas       │
 *  │  Modal      →  apertura/cierre de diálogos          │
 *  │  Toast      →  notificaciones temporales            │
 *  │  App        →  controlador de acciones de usuario   │
 *  └─────────────────────────────────────────────────────┘
 *
 * NUEVO en v2.0:
 *  - Modal de historial de servicios por vehículo
 *  - CRUD completo de servicios (crear, editar, eliminar lógico)
 *  - Modal de detalle de servicio con descripción completa
 *  - Estadísticas del vehículo (km, servicios, costo total)
 *  - Soporte de logo desde Google Drive con fallback
 */

'use strict';


/* ╔══════════════════════════════════════════════════╗
   ║  CONFIGURACIÓN DE LA API                        ║
   ╚══════════════════════════════════════════════════╝ */

/**
 * URL de la Web App de Google Apps Script.
 * Para obtenerla:
 *  1. Abrí tu Google Sheet → Extensiones → Apps Script
 *  2. Implementar → Nueva implementación → Web App
 *  3. Acceso: "Cualquier usuario"
 *  4. Copiá la URL y pegala acá
 */
const GAS_URL = 'https://script.google.com/macros/s/AKfycbxLbPSoiOpE_iI8uBKirPzHaxKAc6YkVQBD1FqOCg_-a2QAY4498yDovX4cja3Rq5cw/exec';


/* ╔══════════════════════════════════════════════════╗
   ║  CAPA DE COMUNICACIÓN CON GOOGLE APPS SCRIPT    ║
   ╚══════════════════════════════════════════════════╝ */

/**
 * API: Centraliza todas las peticiones fetch a la Web App de GAS.
 * Responde con el campo `data` en éxito, o lanza Error en fallo.
 *
 * Protocolo esperado del backend (Code.gs):
 *  { ok: true,  data: <resultado> }  ← Éxito
 *  { ok: false, error: <mensaje>  }  ← Error controlado
 */
const API = {

  /**
   * Realiza un POST al endpoint de GAS.
   * Usa text/plain para evitar el preflight CORS.
   * @param {string} action  - Nombre de la acción en el switch de Code.gs
   * @param {Object} [datos] - Payload adicional
   * @returns {Promise<*>}
   */
  async llamar(action, datos = {}) {
    const res = await fetch(GAS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, datos }),
    });

    if (!res.ok) throw new Error(`Error HTTP ${res.status}: ${res.statusText}`);

    const json = await res.json();
    if (!json.ok) throw new Error(json.error || 'Error desconocido en el servidor.');
    return json.data;
  },

  /* ── CLIENTES ── */
  getClientesActivos()          { return this.llamar('getClientesActivos'); },
  getTodosLosClientes()         { return this.llamar('getTodosLosClientes'); },
  agregarCliente(datos)         { return this.llamar('agregarCliente', datos); },
  actualizarCliente(id, datos)  { return this.llamar('actualizarCliente', { id, ...datos }); },
  eliminarClienteLogico(id)     { return this.llamar('eliminarClienteLogico', { id }); },

  /* ── VEHÍCULOS ── */
  getVehiculosActivos(idCliente = null) {
    return this.llamar('getVehiculosActivos', { idCliente });
  },
  agregarVehiculo(datos)        { return this.llamar('agregarVehiculo', datos); },
  actualizarVehiculo(id, datos) { return this.llamar('actualizarVehiculo', { id, ...datos }); },
  eliminarVehiculoLogico(id)    { return this.llamar('eliminarVehiculoLogico', { id }); },

  /* ── HISTORIAL DE SERVICIOS ── */

  /**
   * Trae todos los servicios (activos y eliminados) de un vehículo.
   * El filtro de estado 'Activo' se aplica en el frontend.
   * @param {string} idVehiculo
   * @returns {Promise<Array>}
   */
  getHistorialPorVehiculo(idVehiculo) {
    return this.llamar('getHistorialPorVehiculo', { idVehiculo });
  },

  /**
   * Agrega un nuevo registro de servicio al historial.
   * @param {Object} datos - { ID_Vehiculo, Fecha, KM, Descripcion_Trabajo, Costo }
   * @returns {Promise<Object>} El servicio recién creado con su ID
   */
  agregarServicio(datos)        { return this.llamar('agregarServicio', datos); },

  /**
   * Actualiza un registro de servicio existente.
   * @param {string} id
   * @param {Object} datos - Campos a modificar
   */
  actualizarServicio(id, datos) { return this.llamar('actualizarServicio', { id, ...datos }); },

  /**
   * Borrado lógico: cambia Estado a 'Eliminado' en el Sheet.
   * El registro permanece en la hoja pero no se muestra en la UI.
   * @param {string} id
   */
  eliminarServicioLogico(id)    { return this.llamar('eliminarServicioLogico', { id }); },
};


/* ╔══════════════════════════════════════════════════╗
   ║  CACHE LOCAL                                    ║
   ╚══════════════════════════════════════════════════╝ */

/**
 * Cache: Almacena datos del Sheet en memoria durante la sesión.
 * Reduce llamadas al backend. Se invalida al modificar datos.
 */
const Cache = {
  _store: {},
  set(clave, valor)  { this._store[clave] = valor; },
  get(clave)         { return this._store[clave] ?? null; },
  invalidar(clave)   { delete this._store[clave]; },
  limpiar()          { this._store = {}; },
};


/* ╔══════════════════════════════════════════════════╗
   ║  CAPA DE DATOS (DataStore)                      ║
   ╚══════════════════════════════════════════════════╝ */

/**
 * DataStore: Encapsula el acceso y mutación de datos.
 * Todos los métodos son async y usan Cache + API.
 */
const DataStore = {

  /* ── CLIENTES ── */

  async getClientesActivos() {
    if (!Cache.get('clientesActivos')) {
      const clientes = await API.getClientesActivos();
      Cache.set('clientesActivos', clientes);
    }
    return Cache.get('clientesActivos');
  },

  async getTodosLosClientes() {
    return API.getTodosLosClientes();
  },

  async getClientePorId(id) {
    const clientes = await this.getTodosLosClientes();
    return clientes.find(c => c.ID_Cliente === id);
  },

  async agregarCliente(datosCliente) {
    const nuevo = await API.agregarCliente(datosCliente);
    Cache.invalidar('clientesActivos');
    return nuevo;
  },

  async actualizarCliente(id, datosActualizados) {
    const resultado = await API.actualizarCliente(id, datosActualizados);
    Cache.invalidar('clientesActivos');
    return resultado;
  },

  async eliminarClienteLogico(id) {
    const resultado = await API.eliminarClienteLogico(id);
    Cache.invalidar('clientesActivos');
    return resultado;
  },

  /* ── VEHÍCULOS ── */

  async getVehiculosActivos(idCliente = null) {
    const clave = `vehiculosActivos_${idCliente || 'todos'}`;
    if (!Cache.get(clave)) {
      const vehiculos = await API.getVehiculosActivos(idCliente);
      Cache.set(clave, vehiculos);
    }
    return Cache.get(clave);
  },

  async agregarVehiculo(datos) {
    const nuevo = await API.agregarVehiculo(datos);
    Cache.invalidar('vehiculosActivos_todos');
    Cache.invalidar(`vehiculosActivos_${datos.ID_Cliente}`);
    return nuevo;
  },

  /**
   * Actualiza los datos de un vehículo existente.
   * @param {string} id - ID_Vehiculo
   * @param {Object} datos - Campos a modificar
   */
  async actualizarVehiculo(id, datos) {
    const resultado = await API.actualizarVehiculo(id, datos);
    Cache.limpiar(); // Limpia todo el caché de vehículos
    return resultado;
  },

  async eliminarVehiculoLogico(id) {
    const resultado = await API.eliminarVehiculoLogico(id);
    Cache.limpiar();
    return resultado;
  },

  /* ── HISTORIAL DE SERVICIOS ── */

  /**
   * Trae el historial de un vehículo y filtra solo los registros 'Activos'.
   * BORRADO LÓGICO: los registros con Estado='Eliminado' no se muestran,
   * pero siguen existiendo en la hoja de Google Sheets.
   *
   * @param {string} idVehiculo
   * @returns {Promise<Array>} Solo servicios activos, ordenados por fecha desc
   */
  async getHistorialActivoPorVehiculo(idVehiculo) {
    // Clave de caché específica por vehículo
    const clave = `historial_${idVehiculo}`;
    if (!Cache.get(clave)) {
      const todos = await API.getHistorialPorVehiculo(idVehiculo);
      Cache.set(clave, todos);
    }
    // Filtra activos y ordena por fecha descendente (más reciente primero)
    return (Cache.get(clave) || [])
      .filter(s => s.Estado === 'Activo')
      .sort((a, b) => new Date(b.Fecha) - new Date(a.Fecha));
  },

  /**
   * Agrega un nuevo servicio e invalida el caché del vehículo.
   * @param {Object} datos - { ID_Vehiculo, Fecha, KM, Descripcion_Trabajo, Costo }
   */
  async agregarServicio(datos) {
    const nuevo = await API.agregarServicio(datos);
    Cache.invalidar(`historial_${datos.ID_Vehiculo}`);
    return nuevo;
  },

  /**
   * Actualiza un servicio existente.
   * @param {string} id
   * @param {string} idVehiculo - Necesario para invalidar el caché correcto
   * @param {Object} datos
   */
  async actualizarServicio(id, idVehiculo, datos) {
    const resultado = await API.actualizarServicio(id, datos);
    Cache.invalidar(`historial_${idVehiculo}`);
    return resultado;
  },

  /**
   * Borrado lógico de servicio: cambia Estado a 'Eliminado'.
   * El registro se preserva en el Sheet para auditoría.
   * @param {string} id
   * @param {string} idVehiculo
   */
  async eliminarServicioLogico(id, idVehiculo) {
    const resultado = await API.eliminarServicioLogico(id);
    Cache.invalidar(`historial_${idVehiculo}`);
    return resultado;
  },
};


/* ╔══════════════════════════════════════════════════╗
   ║  CAPA DE UI (Renderizado)                       ║
   ╚══════════════════════════════════════════════════╝ */

const UI = {

  /* ── CLIENTES ── */

  async renderizarTablaClientes(filtro = '') {
    const tbody   = document.getElementById('tbodyClientes');
    const emptyEl = document.getElementById('emptyClientes');
    const countEl = document.getElementById('countClientes');

    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-muted)">Cargando…</td></tr>';

    try {
      const clientes = (await DataStore.getClientesActivos()).filter(c =>
        c.Nombre.toLowerCase().includes(filtro.toLowerCase())
      );

      tbody.innerHTML = '';

      if (clientes.length === 0) {
        emptyEl.hidden = false;
        countEl.textContent = '0 registros';
        return;
      }

      emptyEl.hidden = true;
      countEl.textContent = `${clientes.length} registro${clientes.length !== 1 ? 's' : ''}`;

      const fragment = document.createDocumentFragment();
      clientes.forEach(cliente => {
        const tr = document.createElement('tr');
        tr.dataset.id = cliente.ID_Cliente;
        tr.title = 'Doble clic para ver detalles';
        tr.classList.add('row--clickable');
        tr.innerHTML = `
          <td style="color:var(--text-muted);font-size:0.75rem;">${escapeHtml(cliente.ID_Cliente)}</td>
          <td style="font-weight:500;">${escapeHtml(cliente.Nombre)}</td>
          <td>${escapeHtml(cliente.Telefono) || '<span style="color:var(--text-muted)">—</span>'}</td>
          <td>${escapeHtml(cliente.Direccion) || '<span style="color:var(--text-muted)">—</span>'}</td>
          <td>${escapeHtml(cliente.Email) || '<span style="color:var(--text-muted)">—</span>'}</td>
        `;
        // Doble clic → ficha de cliente
        tr.addEventListener('dblclick', () => App.abrirDetalleCliente(cliente.ID_Cliente));
        fragment.appendChild(tr);
      });

      tbody.appendChild(fragment);
      lucide.createIcons();

    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--danger)">
        Error al cargar datos: ${escapeHtml(err.message)}
      </td></tr>`;
      console.error('renderizarTablaClientes:', err);
    }
  },

  /**
   * Renderiza la tabla principal de vehículos.
   * Cada fila incluye un botón de historial y es clickeable.
   * @param {string} [filtro='']
   */
  async renderizarTablaVehiculos(filtro = '') {
    const tbody   = document.getElementById('tbodyVehiculos');
    const emptyEl = document.getElementById('emptyVehiculos');
    const countEl = document.getElementById('countVehiculos');

    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:var(--text-muted)">Cargando…</td></tr>';

    try {
      const termino   = filtro.toLowerCase();
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

      const todosLosClientes = await DataStore.getClientesActivos();
      const fragment = document.createDocumentFragment();

      vehiculos.forEach(v => {
        const cliente = todosLosClientes.find(c => c.ID_Cliente === v.ID_Cliente);
        const nombreCliente = cliente ? escapeHtml(cliente.Nombre) : 'Desconocido';

        const tr = document.createElement('tr');
        tr.dataset.id = v.ID_Vehiculo;
        tr.classList.add('row--clickable');
        tr.title = 'Clic para ver historial de servicios';

        tr.innerHTML = `
          <td style="color:var(--text-muted);font-size:0.75rem;">${escapeHtml(v.ID_Vehiculo)}</td>
          <td style="font-weight:600;letter-spacing:0.04em;color:var(--text-primary)">${escapeHtml(v.Patente)}</td>
          <td>${escapeHtml(v.Marca)}</td>
          <td>${escapeHtml(v.Modelo)}</td>
          <td>${v.Año || '—'}</td>
          <td>${escapeHtml(v.Color) || '—'}</td>
          <td>${nombreCliente}</td>
          <td>${UI.badgeEstado(v.Estado)}</td>
          <td>
            <div class="actions-cell">
              <button class="btn-icon btn-icon--history" title="Ver historial de servicios">
                <i data-lucide="clipboard-list"></i>
              </button>
              <button class="btn-icon" title="Editar vehículo" data-action="editar-vehiculo">
                <i data-lucide="edit-3"></i>
              </button>
            </div>
          </td>
        `;

        // Clic en la fila → historial del vehículo (ignora clic en botones)
        tr.addEventListener('click', (e) => {
          if (e.target.closest('.btn-icon')) return;
          App.abrirHistorialVehiculo(v.ID_Vehiculo);
        });

        tr.querySelector('.btn-icon--history').addEventListener('click', (e) => {
          e.stopPropagation();
          App.abrirHistorialVehiculo(v.ID_Vehiculo);
        });

        tr.querySelector('[data-action="editar-vehiculo"]').addEventListener('click', (e) => {
          e.stopPropagation();
          App.abrirEdicionVehiculo(v.ID_Vehiculo);
        });

        fragment.appendChild(tr);
      });

      tbody.appendChild(fragment);
      lucide.createIcons();

    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;color:var(--danger)">
        Error al cargar datos: ${escapeHtml(err.message)}
      </td></tr>`;
      console.error('renderizarTablaVehiculos:', err);
    }
  },

  /**
   * Rellena la sub-tabla de vehículos en el modal de detalle de cliente.
   * @param {string} idCliente
   */
  async renderizarVehiculosDeCliente(idCliente) {
    const tbody   = document.getElementById('tbodyVehiculosCliente');
    const emptyEl = document.getElementById('emptyVehiculosCliente');

    // Siempre resetea el estado vacío antes de cargar
    emptyEl.hidden = true;
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-muted)">Cargando…</td></tr>';

    try {
      const vehiculos = await DataStore.getVehiculosActivos(idCliente);
      tbody.innerHTML = '';

      if (vehiculos.length === 0) {
        emptyEl.hidden = false;
        return;
      }

      // Asegura que el empty esté oculto cuando hay datos
      emptyEl.hidden = true;

      vehiculos.forEach(v => {
        const tr = document.createElement('tr');
        tr.classList.add('row--clickable');
        tr.title = 'Clic para ver historial de servicios';
        tr.innerHTML = `
          <td style="font-weight:600;color:var(--text-primary);font-size:0.9rem;letter-spacing:0.03em">${escapeHtml(v.Patente)}</td>
          <td>${escapeHtml(v.Marca)}</td>
          <td>${escapeHtml(v.Modelo)}</td>
          <td>${v.Año || '—'}</td>
          <td>${escapeHtml(v.Color) || '—'}</td>
          <td style="text-align:right;padding-right:12px">
            <button class="btn btn--sm btn--outline" title="Ver historial de servicios" style="gap:6px">
              <i data-lucide="clipboard-list"></i>
              Historial
            </button>
          </td>
        `;

        // Clic en cualquier parte de la fila → cierra ficha y abre historial
        tr.addEventListener('click', () => {
          Modal.cerrar('modalDetalleCliente');
          // Pequeño delay para que el cierre se vea fluido antes de abrir el historial
          setTimeout(() => App.abrirHistorialVehiculo(v.ID_Vehiculo), 120);
        });

        tbody.appendChild(tr);
      });

      // Renderiza íconos Lucide dentro del tbody actualizado
      lucide.createIcons({ nodes: [tbody] });

    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--danger)">${escapeHtml(err.message)}</td></tr>`;
    }
  },

  /**
   * Renderiza la tabla del historial de servicios de un vehículo.
   * Solo muestra registros con Estado='Activo' (borrado lógico aplicado).
   * Cada fila es clickeable para ver el detalle completo de la descripción.
   * @param {string} idVehiculo
   */
  async renderizarTablaHistorial(idVehiculo) {
    const tbody   = document.getElementById('tbodyHistorial');
    const emptyEl = document.getElementById('emptyHistorial');

    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-muted)">Cargando…</td></tr>';

    try {
      // Obtiene solo servicios activos, ordenados por fecha descendente
      const servicios = await DataStore.getHistorialActivoPorVehiculo(idVehiculo);

      tbody.innerHTML = '';

      if (servicios.length === 0) {
        emptyEl.hidden = false;
        return;
      }

      emptyEl.hidden = true;
      const fragment = document.createDocumentFragment();

      servicios.forEach(s => {
        const tr = document.createElement('tr');
        tr.dataset.id = s.ID_Servicio;
        tr.classList.add('row--clickable');
        tr.title = 'Clic para ver detalle completo';

        // Formatea el costo como moneda
        const costoFormateado = s.Costo
          ? `$${parseFloat(s.Costo).toLocaleString('es-AR')}`
          : '—';

        // Formatea la fecha para mostrarla más legible
        const fechaDisplay = formatearFecha(s.Fecha);

        tr.innerHTML = `
          <td style="color:var(--text-muted);font-size:0.75rem;font-family:monospace">${escapeHtml(s.ID_Servicio)}</td>
          <td style="white-space:nowrap">${escapeHtml(fechaDisplay)}</td>
          <td style="font-variant-numeric:tabular-nums">${s.KM ? Number(s.KM).toLocaleString('es-AR') + ' km' : '—'}</td>
          <!-- Descripción truncada: el texto completo se ve en el modal de detalle -->
          <td class="desc-truncada" title="${escapeHtml(s.Descripcion_Trabajo)}">${escapeHtml(s.Descripcion_Trabajo)}</td>
          <td style="color:var(--accent);font-weight:600">${escapeHtml(costoFormateado)}</td>
          <td>${UI.badgeEstado(s.Estado)}</td>
          <td>
            <div class="actions-cell">
              <!-- Botón editar: abre el form pre-cargado -->
              <button class="btn-icon" title="Editar servicio" data-action="editar" data-id="${escapeHtml(s.ID_Servicio)}">
                <i data-lucide="edit-3"></i>
              </button>
              <!-- Botón eliminar: borrado lógico -->
              <button class="btn-icon btn-icon--danger" title="Eliminar servicio" data-action="eliminar" data-id="${escapeHtml(s.ID_Servicio)}">
                <i data-lucide="trash-2"></i>
              </button>
            </div>
          </td>
        `;

        // Clic en la fila → modal de detalle completo del servicio
        tr.addEventListener('click', (e) => {
          // No interceptar si el clic fue en un botón de acción
          if (e.target.closest('[data-action]')) return;
          App.abrirDetalleServicio(s.ID_Servicio, idVehiculo);
        });

        // Botón editar
        tr.querySelector('[data-action="editar"]').addEventListener('click', (e) => {
          e.stopPropagation();
          App.abrirEdicionServicio(s.ID_Servicio, idVehiculo);
        });

        // Botón eliminar (borrado lógico)
        tr.querySelector('[data-action="eliminar"]').addEventListener('click', (e) => {
          e.stopPropagation();
          App.eliminarServicio(s.ID_Servicio, idVehiculo);
        });

        fragment.appendChild(tr);
      });

      tbody.appendChild(fragment);
      lucide.createIcons();

      // Actualiza las tarjetas de estadísticas
      UI.renderizarEstadisticasHistorial(servicios);

    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--danger)">
        Error al cargar historial: ${escapeHtml(err.message)}
      </td></tr>`;
      console.error('renderizarTablaHistorial:', err);
    }
  },

  /**
   * Calcula y renderiza las tarjetas de estadísticas del historial.
   * Muestra: cantidad de servicios, último KM registrado, costo total acumulado.
   * @param {Array} servicios - Servicios activos ya filtrados
   */
  renderizarEstadisticasHistorial(servicios) {
    const statsEl = document.getElementById('historialStats');

    if (!servicios.length) {
      statsEl.innerHTML = '';
      return;
    }

    // Cantidad total de servicios activos
    const cantServicios = servicios.length;

    // El KM más alto registrado (no necesariamente el más reciente en el tiempo)
    const ultimoKM = Math.max(...servicios.map(s => parseInt(s.KM) || 0));

    // Suma de todos los costos (ignorando vacíos)
    const costoTotal = servicios.reduce((acc, s) => acc + (parseFloat(s.Costo) || 0), 0);

    statsEl.innerHTML = `
      <div class="stat-card">
        <span class="stat-card__label">Servicios</span>
        <span class="stat-card__value">${cantServicios}</span>
      </div>
      <div class="stat-card">
        <span class="stat-card__label">KM máximo</span>
        <span class="stat-card__value">${ultimoKM > 0 ? ultimoKM.toLocaleString('es-AR') : '—'}</span>
      </div>
      <div class="stat-card stat-card--accent">
        <span class="stat-card__label">Costo total</span>
        <span class="stat-card__value">${costoTotal > 0 ? '$' + costoTotal.toLocaleString('es-AR') : '—'}</span>
      </div>
    `;
  },

  /**
   * Renderiza el contenido del modal de detalle de servicio.
   * Muestra todos los campos del servicio, con la descripción en texto completo.
   * @param {Object} servicio - El objeto servicio completo
   * @param {string} idVehiculo - Para contexto
   */
  renderizarDetalleServicio(servicio, idVehiculo) {
    const el = document.getElementById('servicioDetalleContent');

    const costoFormateado = servicio.Costo
      ? `$${parseFloat(servicio.Costo).toLocaleString('es-AR')}`
      : 'No registrado';

    el.innerHTML = `
      <!-- Fila de campos meta: ID, fecha, KM, costo, estado -->
      <div class="servicio-detalle">
        <div class="servicio-detalle__meta">
          <div class="servicio-detalle__campo">
            <span class="servicio-detalle__label">ID Servicio</span>
            <span class="servicio-detalle__valor" style="font-family:monospace;color:var(--text-muted)">${escapeHtml(servicio.ID_Servicio)}</span>
          </div>
          <div class="servicio-detalle__campo">
            <span class="servicio-detalle__label">Fecha</span>
            <span class="servicio-detalle__valor">${escapeHtml(formatearFecha(servicio.Fecha))}</span>
          </div>
          <div class="servicio-detalle__campo">
            <span class="servicio-detalle__label">Kilometraje</span>
            <span class="servicio-detalle__valor">${servicio.KM ? Number(servicio.KM).toLocaleString('es-AR') + ' km' : '—'}</span>
          </div>
          <div class="servicio-detalle__campo">
            <span class="servicio-detalle__label">Costo</span>
            <span class="servicio-detalle__valor servicio-detalle__valor--costo">${escapeHtml(costoFormateado)}</span>
          </div>
          <div class="servicio-detalle__campo">
            <span class="servicio-detalle__label">Estado</span>
            <span class="servicio-detalle__valor">${UI.badgeEstado(servicio.Estado)}</span>
          </div>
        </div>

        <!-- Descripción completa del trabajo realizado -->
        <div class="servicio-detalle__descripcion">
          <div class="servicio-detalle__descripcion-label">
            <i data-lucide="wrench" style="display:inline-block;vertical-align:middle;width:13px;height:13px;margin-right:4px;color:var(--accent)"></i>
            Descripción del trabajo
          </div>
          <p class="servicio-detalle__descripcion-texto">${escapeHtml(servicio.Descripcion_Trabajo || 'Sin descripción registrada.')}</p>
        </div>
      </div>
    `;

    // Registra el ID en el objeto App para que los botones Editar/Eliminar del modal sepan qué servicio es
    App.servicioActivoId    = servicio.ID_Servicio;
    App.vehiculoActivoId    = idVehiculo;

    // Recrea íconos Lucide dentro del detalle renderizado
    lucide.createIcons({ nodes: [el] });
  },

  /**
   * Renderiza la ficha de datos del cliente en el modal de detalle.
   * @param {Object} cliente
   */
  renderizarFichaCliente(cliente) {
    const fichaEl = document.getElementById('fichaCliente');
    fichaEl.innerHTML = `
      <div class="client-card__field">
        <span class="client-card__label">ID</span>
        <span class="client-card__value" style="font-family:monospace;color:var(--text-secondary)">${escapeHtml(cliente.ID_Cliente)}</span>
      </div>
      <div class="client-card__field">
        <span class="client-card__label">Nombre</span>
        <span class="client-card__value">${escapeHtml(cliente.Nombre)}</span>
      </div>
      <div class="client-card__field">
        <span class="client-card__label">Teléfono</span>
        <span class="client-card__value">${escapeHtml(cliente.Telefono) || '—'}</span>
      </div>
      <div class="client-card__field">
        <span class="client-card__label">Dirección</span>
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
   */
  async poblarSelectClientes() {
    const select = document.getElementById('inputClienteVehiculo');
    select.innerHTML = '<option value="">Cargando clientes…</option>';
    select.disabled = true;

    try {
      const clientes = await DataStore.getClientesActivos();
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
      select.disabled = false;
    }
  },

  /**
   * Genera el HTML de un badge de estado.
   * @param {string} estado - 'Activo' o 'Eliminado'
   */
  badgeEstado(estado) {
    const clase = estado === 'Activo' ? 'badge--activo' : 'badge--eliminado';
    return `<span class="badge ${clase}">${escapeHtml(estado)}</span>`;
  },
};


/* ╔══════════════════════════════════════════════════╗
   ║  GESTIÓN DE MODALES                             ║
   ╚══════════════════════════════════════════════════╝ */

const Modal = {

  abrir(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.hidden = false;
    document.body.style.overflow = 'hidden';
    setTimeout(() => {
      const primerInput = el.querySelector('input:not([type="hidden"]), select, textarea');
      if (primerInput) primerInput.focus();
    }, 100);
  },

  cerrar(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.hidden = true;
    document.body.style.overflow = '';
  },

  limpiarFormulario(formId) {
    const form = document.getElementById(formId);
    if (form) {
      form.reset();
      form.querySelectorAll('.error').forEach(el => el.classList.remove('error'));
    }
  },
};


/* ╔══════════════════════════════════════════════════╗
   ║  SISTEMA DE NOTIFICACIONES (Toast)              ║
   ╚══════════════════════════════════════════════════╝ */

function mostrarToast(mensaje, tipo = 'info', duracion = 3000) {
  const container = document.getElementById('toastContainer');
  const iconos = { success: 'check-circle-2', error: 'x-circle', info: 'info' };

  const toast = document.createElement('div');
  toast.className = `toast toast--${tipo}`;
  toast.innerHTML = `<i data-lucide="${iconos[tipo] || 'info'}"></i> ${escapeHtml(mensaje)}`;
  container.appendChild(toast);

  lucide.createIcons({ nodes: [toast] });
  setTimeout(() => toast.remove(), duracion + 400);
}



/* ╔══════════════════════════════════════════════════╗
   ║  MÓDULO PRESUPUESTO                             ║
   ╚══════════════════════════════════════════════════╝ */



/* ╔══════════════════════════════════════════════════╗
   ║  MÓDULO DE PRESUPUESTO                          ║
   ╚══════════════════════════════════════════════════╝ */

/**
 * Presupuesto: gestiona la tabla de ítems editable en pantalla
 * y la exportación a PDF con logo usando jsPDF.
 *
 * Estructura de cada ítem:
 *  { id, cantidad, detalle, precioUnitario, total }
 */
const Presupuesto = {

  /** Logo de Dico Racing en base64 (embebido para que funcione offline) */
  LOGO_B64: 'data:image/png;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/4gHYSUNDX1BST0ZJTEUAAQEAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADb/2wBDAAUDBAQEAwUEBAQFBQUGBwwIBwcHBw8LCwkMEQ8SEhEPERETFhwXExQaFRERGCEYGh0dHx8fExciJCIeJBweHx7/2wBDAQUFBQcGBw4ICA4eFBEUHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh7/wAARCAG/Ai8DASIAAhEBAxEB/8QAHQABAAEEAwEAAAAAAAAAAAAAAAcFBggJAQMEAv/EAE0QAAEDAwEFBQQIAggFAgQHAAEAAgMEBREGBxIhMUEIE1FhcRQigZEJIzJCobHB0RVSFiQzQ2JykuEXU4Ki8CXSGFSEsjRERlZ0lPH/xAAcAQEAAwEBAQEBAAAAAAAAAAAAAQIDBgcFBAj/xAA3EQACAQIEBAMHAwMEAwAAAAAAAQIEEQMFITEGEkFRYXHBEyKBkaGx0RQy8BVC4QcjM/FSYnL/2gAMAwEAAhEDEQA/AMMkREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBEXLWlzg1oJJ4AAc0BwilnZ12fdo2taWOtpLdHQUch4S1jizI8QMfspRh7H9RT0ofeNb0NLLgZAj4fiVDaQsYqosg9ZdmC92qjdU2TU9ou27xMfehjj6c1COotPXjT9Y6lutFJA9pxkjLT6FTcFKREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBEVQ0/Zrlf7tBarTSSVVXO4NZGwZJKAp6LMDZR2RGPpoLjru5EPcA40NNyHk537Kf9P7GNmtjijZR6Ut7i0Ab0se+Tjr72eKq5JEpGtG1WK83WURW62VdS88hHESr1s+xDajdcey6SrcHjl4DR+a2V2+zWm2t3aC3UlKB0ihDfyXuAAwAAD5KOYnlNdNv7MW1mrkDXWenpwTxMs4GFdNH2P8AX0jC6outqgOOW8XLO0gZyVz08U5mOVGAF97Ju0ugjdJRut1wDRnDJd0/IqGtY6S1DpG5G36htc9BUdBIOB9CtsY68Va+0fQundd2Ce032gimEjCI5d0b8Z6Oaeh/ZFJ9RymqhFe+2rZ9X7N9dVen6s95CDv0s3/MjPI+qshXKhERAEREAREQBERAEREAREQBERAEREAREQBERAfTGue9rGNLnOOABzJWbPZT7P8AQ2m2UusdYUjKm4ztElLTSDLYWnkSPFQD2TNGN1htft7amAS0NBmpnB5Hd+yD8fyWbm3/AFxHs92Y3C8RENqS3uKRoH33cBw8lVvoSl1LH7Ru3+27O45dPWFrKq/mMYAH1cA443vPyWEWrtdar1Vc5bher3V1EkhyWiUhjfIDKot2uFZdbjPcLhUPqKmd5fJI85JJUm7IdkDtW291/wBQXiCxWJjsCaUjflI/lBU2sNyM2XK4s+zX1TfSV37qonVd7ktj7bVVRq6Zwxuz++W+h5rIik2G7KNU0slDpDWrnXVgOBKeDyPIrH3a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bng3nlQspS7VFEaHbbfG5J714lGfNRc1rnO3WtLj4AKVsVOFkT2QNQC8XCv2aXuMVlrucD3RNl94ROA44zy6LHZZKdijRdc3UdRr24MfS2ugheGSPGBIcZJHkPFHsStyC9otgOl9bXawk7wpKlzGn/DngrfV1bWr3FqLaPfLxBjuqireWYOQQDgK1VJAREQBERAFW9DzxU+qKOWZwazLm5PiWkD8SqIuQSDkcCh+ikqHTY8MZK/K0/k7k68Dy+as7alcBFQU9sYfelPevx4DgB8+Ko1j1tWUMLIKqBtXGwYB3t13zVF1JdpL1c3VskYjBaGtYDnAC0lJNHoWf8W0tblrwqdtTlZNW2XXw8CmoiLM81CIiAqOnI7ZNdY47tI+OmOcuaeuOGfLKl210lDR0rW2+GJkWODmDmPEnqoRVbsGprjaB3cbxLATkxv5fA9FaMktzreF89pssxGqjDTT/uS1X+PIlwk+qDPQZCtSi13aZIc1cc8EmR7rW74+fBee868pY42ttULpZCOLpRuhvw/3Wjkt7npOJxTlUML2ntk/Bb/IvCaaKCIyzysijAyXOOArUvGuKGmLo6GI1Ug5P3sMH7qxLrda+5zGSsqHSHo3k0fBeFUc30OHzPjupxrwo48i7vV/hfUrV41NdrmSJKgxRcu7iO6MefiqMSSck5K4RUOIqKrGqZ8+NJyfiEREMAiIgCIiAIiIAiIgCIiAIiIAiIgCIiAIiIAiIgCIiAIiIAiIgCIiAIiIAiIgCIiAIiIAiIgCIiAKX+y3tMbs91v3Ve4/wm5ARVHHAjd916iBEBkt24dJP/pDQa5trO/t1dA2KWWMZaHDiDnzBWOlnr5rXcoK+BrHSQu3g17ctPkQpQ2dbYJ6DTsujNY05vOnZxugPd78HDGW+KjvVlHa6O7yNsteK2hf70T8Yc0eBHiFCQJo0rtK2KyUTZtUbNw24g5eaYAxuPiBwx6L42r9oWa9aedpXRFpbp+yuZuPLDh7x1AxyH4qA0SwCIikBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQH//Z',

  /** Array de ítems del presupuesto actual */
  items: [],

  /** Contador para IDs únicos de fila */
  _nextId: 1,

  /* ── INICIALIZACIÓN ── */

  /**
   * Inicializa el módulo: pone la fecha de hoy, agrega una fila vacía
   * y conecta todos los eventos de la sección.
   */
  init() {
    // Fecha de hoy como valor por defecto
    const hoy = new Date().toISOString().split('T')[0];
    const inputFecha = document.getElementById('presFecha');
    if (inputFecha && !inputFecha.value) inputFecha.value = hoy;

    // Empieza con 3 filas vacías para mejor UX
    this.items = [];
    this._nextId = 1;
    this.agregarItem();
    this.agregarItem();
    this.agregarItem();
    this.renderizarTabla();

    // Botón agregar ítem
    document.getElementById('btnAgregarItem')?.addEventListener('click', () => {
      this.agregarItem();
      this.renderizarTabla();
      // Foco en el último detalle ingresado
      setTimeout(() => {
        const filas = document.querySelectorAll('#tbodyPresupuesto tr');
        const ultima = filas[filas.length - 1];
        ultima?.querySelector('input[data-campo="detalle"]')?.focus();
      }, 50);
    });

    // Botón "Previsualizar / Exportar PDF" — abre el modal de preview
    document.getElementById('btnExportarPDF')?.addEventListener('click', () => {
      this.previsualizarPDF();
    });

    // Botón limpiar / nuevo presupuesto
    document.getElementById('btnLimpiarPresupuesto')?.addEventListener('click', () => {
      if (this.items.some(i => i.detalle.trim())) {
        if (!confirm('¿Limpiar el presupuesto actual y comenzar uno nuevo?')) return;
      }
      document.getElementById('presCliente').value       = '';
      document.getElementById('presVehiculo').value      = '';
      document.getElementById('presObservaciones').value = '';
      document.getElementById('presValidez').value       = '15';
      const hoy2 = new Date().toISOString().split('T')[0];
      document.getElementById('presFecha').value = hoy2;
      this.items    = [];
      this._nextId  = 1;
      this.agregarItem();
      this.agregarItem();
      this.agregarItem();
      this.renderizarTabla();
      mostrarToast('Presupuesto limpiado.', 'info');
    });
  },

  /* ── GESTIÓN DE ÍTEMS ── */

  /** Agrega un ítem vacío al array y re-renderiza. */
  agregarItem() {
    this.items.push({
      id:            this._nextId++,
      cantidad:      1,
      detalle:       '',
      precioUnitario: 0,
      total:         0,
    });
  },

  /** Elimina un ítem por su id interno. */
  eliminarItem(id) {
    if (this.items.length <= 1) return; // Siempre deja al menos 1 fila
    this.items = this.items.filter(i => i.id !== id);
    this.renderizarTabla();
    this.actualizarTotal();
  },

  /** Actualiza un campo de un ítem y recalcula su total. */
  actualizarCampo(id, campo, valor) {
    const item = this.items.find(i => i.id === id);
    if (!item) return;

    item[campo] = campo === 'detalle' ? valor : (parseFloat(valor) || 0);

    // Recalcula el subtotal de la fila
    item.total = item.cantidad * item.precioUnitario;

    // Actualiza solo la celda de total de esa fila (sin re-renderizar todo)
    const totalEl = document.querySelector(`[data-id="${id}"] .td-total`);
    if (totalEl) totalEl.textContent = this.formatearPeso(item.total);

    this.actualizarTotal();
  },

  /** Recalcula y muestra el total general del presupuesto. */
  actualizarTotal() {
    const total = this.items.reduce((acc, i) => acc + (i.total || 0), 0);
    const el = document.getElementById('presTotal');
    if (el) el.textContent = this.formatearPeso(total);
  },

  /** Formatea un número como moneda argentina. */
  formatearPeso(valor) {
    return '$' + (valor || 0).toLocaleString('es-AR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  },

  /* ── RENDERIZADO DE LA TABLA ── */

  /**
   * Dibuja todas las filas del presupuesto en el tbody.
   * Cada celda tiene un input editable que actualiza el array en tiempo real.
   */
  renderizarTabla() {
    const tbody = document.getElementById('tbodyPresupuesto');
    if (!tbody) return;

    tbody.innerHTML = '';

    this.items.forEach((item, idx) => {
      const tr = document.createElement('tr');
      tr.dataset.id = item.id;

      tr.innerHTML = `
        <!-- Número de fila (solo visual, no editable) -->
        <td class="td-num">${idx + 1}</td>

        <!-- Cantidad -->
        <td style="width:80px">
          <input
            type="number"
            data-campo="cantidad"
            value="${item.cantidad}"
            min="0.01"
            step="0.01"
            style="text-align:center"
            aria-label="Cantidad"
          />
        </td>

        <!-- Detalle del servicio o insumo -->
        <td>
          <input
            type="text"
            data-campo="detalle"
            value="${escapeHtml(item.detalle)}"
            placeholder="Descripción del servicio o insumo…"
            aria-label="Detalle"
          />
        </td>

        <!-- Precio unitario -->
        <td style="width:150px">
          <input
            type="number"
            data-campo="precioUnitario"
            value="${item.precioUnitario || ''}"
            min="0"
            step="0.01"
            placeholder="0,00"
            style="text-align:right"
            aria-label="Precio unitario"
          />
        </td>

        <!-- Total de la fila (solo lectura) -->
        <td class="td-total">${this.formatearPeso(item.total)}</td>

        <!-- Botón eliminar fila -->
        <td style="text-align:center;width:44px">
          <button class="btn-fila-eliminar" title="Eliminar fila" data-eliminar="${item.id}">
            <i data-lucide="x"></i>
          </button>
        </td>
      `;

      // Eventos de los inputs: actualiza el item en tiempo real
      tr.querySelectorAll('input[data-campo]').forEach(input => {
        input.addEventListener('input', (e) => {
          this.actualizarCampo(item.id, e.target.dataset.campo, e.target.value);
        });
        // Tab en el último campo del último ítem → agrega nueva fila
        if (input.dataset.campo === 'precioUnitario' && idx === this.items.length - 1) {
          input.addEventListener('keydown', (e) => {
            if (e.key === 'Tab' && !e.shiftKey) {
              e.preventDefault();
              this.agregarItem();
              this.renderizarTabla();
              setTimeout(() => {
                const filas = document.querySelectorAll('#tbodyPresupuesto tr');
                filas[filas.length - 1]?.querySelector('[data-campo="cantidad"]')?.focus();
              }, 30);
            }
          });
        }
      });

      // Botón eliminar fila
      tr.querySelector('[data-eliminar]')?.addEventListener('click', () => {
        this.eliminarItem(item.id);
      });

      tbody.appendChild(tr);
    });

    lucide.createIcons({ nodes: [tbody] });
    this.actualizarTotal();
  },

  /* ── EXPORTAR PDF ── */

  /**
   * Genera y descarga el presupuesto como PDF usando jsPDF.
   * Incluye: logo, encabezado del taller, datos del cliente,
   * tabla de ítems, total y condiciones de validez.
   */
  /**
   * Recopila datos del formulario y valida. Retorna null si hay error.
   * @returns {Object|null}
   */
  _leerFormulario() {
    if (typeof window.jspdf === 'undefined') {
      mostrarToast('Error: la librería de PDF no está disponible.', 'error');
      return null;
    }
    const itemsExportar = this.items.filter(i => i.detalle.trim() !== '');
    if (itemsExportar.length === 0) {
      mostrarToast('Agregá al menos un ítem con detalle para exportar.', 'error');
      return null;
    }
    const cliente       = document.getElementById('presCliente')?.value.trim()       || '';
    const vehiculo      = document.getElementById('presVehiculo')?.value.trim()      || '';
    const fechaInput    = document.getElementById('presFecha')?.value                || '';
    const validez       = parseInt(document.getElementById('presValidez')?.value)    || 15;
    const observaciones = document.getElementById('presObservaciones')?.value.trim() || '';
    const fechaDisplay  = fechaInput
      ? new Date(fechaInput + 'T12:00:00').toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' })
      : new Date().toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' });
    const fechaBase   = fechaInput ? new Date(fechaInput + 'T12:00:00') : new Date();
    const fechaVence  = new Date(fechaBase);
    fechaVence.setDate(fechaVence.getDate() + validez);
    const fechaVenceDisplay = fechaVence.toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' });
    const totalGeneral = itemsExportar.reduce((acc, i) => acc + (i.total || 0), 0);
    const numPres      = 'P-' + Date.now().toString().slice(-6);
    return { cliente, vehiculo, fechaInput, validez, observaciones,
             fechaDisplay, fechaVenceDisplay, totalGeneral, numPres, itemsExportar };
  },

  /**
   * Construye el documento jsPDF y lo devuelve junto con el nombre de archivo.
   * Cabecera blanca/clara — mínimo uso de tinta.
   * @param {Object} datos - Resultado de _leerFormulario()
   * @returns {{ doc: jsPDF, nombreArchivo: string }}
   */
  _generarDoc(datos) {
    const { jsPDF } = window.jspdf;
    const { cliente, vehiculo, validez, observaciones,
            fechaDisplay, fechaVenceDisplay, totalGeneral, numPres, itemsExportar } = datos;

    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const PW  = 210, PH = 297, ML = 18, MR = 18;
    const CW  = PW - ML - MR;
    let   y   = 16;

    /* ── PALETA (toda clara, ahorro de tinta) ── */
    const ACCENT  = [214, 0, 110];     // Rosa Dico Racing — solo textos y líneas
    const BORDER  = [210, 213, 232];   // Gris borde sutil
    const TEXT    = [30,  35,  50];    // Texto oscuro sobre blanco
    const MUTED   = [140, 148, 168];   // Texto secundario
    const SURFACE = [247, 248, 252];   // Relleno muy suave (filas alternas, cajas)

    /* ══════════════════════════════════════════
       CABECERA — blanca, sin fondo sólido oscuro
       ══════════════════════════════════════════ */

    // Línea de acento superior (2 px, rosa)
    doc.setDrawColor(...ACCENT);
    doc.setLineWidth(1.8);
    doc.line(0, 0, PW, 0);

    // Logo (esquina izquierda, sobre fondo blanco)
    try {
      doc.addImage(this.LOGO_B64, 'PNG', ML, y - 4, 30, 30);
    } catch(e) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(18);
      doc.setTextColor(...ACCENT);
      doc.text('DICO', ML, y + 12);
    }

    // Nombre del taller — texto oscuro sobre blanco
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(22);
    doc.setTextColor(...TEXT);
    doc.text('TALLER DICO', ML + 34, y + 8);

    // Subtítulo en rosa
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(...ACCENT);
    doc.text('PRESUPUESTO DE SERVICIOS', ML + 34, y + 15);

    // N° de presupuesto — derecha
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...MUTED);
    doc.text('N° PRESUPUESTO', PW - MR, y + 4, { align: 'right' });
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.setTextColor(...TEXT);
    doc.text(numPres, PW - MR, y + 11, { align: 'right' });

    // Fecha — debajo del número
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...MUTED);
    doc.text(`Fecha: ${fechaDisplay}`, PW - MR, y + 17, { align: 'right' });

    y += 32;

    // Línea separadora fina debajo de la cabecera
    doc.setDrawColor(...BORDER);
    doc.setLineWidth(0.4);
    doc.line(ML, y, PW - MR, y);
    y += 8;

    /* ══════════════════════════════════════════
       DATOS DEL CLIENTE Y VEHÍCULO
       ══════════════════════════════════════════ */
    if (cliente || vehiculo) {
      const boxH = (cliente && vehiculo) ? 20 : 13;
      doc.setFillColor(...SURFACE);
      doc.roundedRect(ML, y, CW, boxH, 2, 2, 'F');
      doc.setDrawColor(...BORDER);
      doc.setLineWidth(0.3);
      doc.roundedRect(ML, y, CW, boxH, 2, 2, 'S');

      if (cliente) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7);
        doc.setTextColor(...MUTED);
        doc.text('CLIENTE', ML + 5, y + 5.5);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
        doc.setTextColor(...TEXT);
        doc.text(cliente, ML + 5, y + 11);
      }
      if (vehiculo) {
        const xV = cliente ? ML + CW / 2 : ML + 5;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7);
        doc.setTextColor(...MUTED);
        doc.text('VEHÍCULO / REFERENCIA', xV, y + 5.5);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
        doc.setTextColor(...TEXT);
        doc.text(vehiculo, xV, y + 11);
      }
      y += boxH + 7;
    }

    /* ══════════════════════════════════════════
       TABLA DE ÍTEMS
       ══════════════════════════════════════════ */
    const colWidths = [12, 16, CW - 12 - 16 - 34 - 34, 34, 34];
    const colX      = [ML];
    for (let i = 1; i < colWidths.length; i++) colX.push(colX[i-1] + colWidths[i-1]);

    const HEAD_H = 8, ROW_H = 7.5;

    // Encabezado tabla — fondo SURFACE con borde inferior rosa
    doc.setFillColor(...SURFACE);
    doc.rect(ML, y, CW, HEAD_H, 'F');
    doc.setDrawColor(...ACCENT);
    doc.setLineWidth(0.5);
    doc.line(ML, y + HEAD_H, ML + CW, y + HEAD_H);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(...MUTED);
    ['#', 'CANT.', 'DETALLE', 'P. UNIT.', 'TOTAL'].forEach((h, i) => {
      const align = i >= 3 ? 'right' : (i === 0 ? 'center' : 'left');
      let xH = colX[i] + (i === 0 ? colWidths[0]/2 : 3);
      if (align === 'right') xH = colX[i] + colWidths[i] - 3;
      doc.text(h, xH, y + 5.5, { align });
    });
    y += HEAD_H;

    itemsExportar.forEach((item, idx) => {
      if (idx % 2 === 0) {
        doc.setFillColor(...SURFACE);
        doc.rect(ML, y, CW, ROW_H, 'F');
      }
      doc.setDrawColor(...BORDER);
      doc.setLineWidth(0.15);
      doc.line(ML, y + ROW_H, ML + CW, y + ROW_H);

      doc.setFontSize(8.5);

      // Nro fila
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...MUTED);
      doc.text(String(idx + 1), colX[0] + colWidths[0]/2, y + 5, { align: 'center' });

      // Cantidad
      doc.setTextColor(...TEXT);
      doc.text(
        item.cantidad % 1 === 0 ? String(item.cantidad) : item.cantidad.toFixed(2),
        colX[1] + colWidths[1] - 3, y + 5, { align: 'right' }
      );

      // Detalle
      const maxDet = colWidths[2] - 6;
      let det = item.detalle;
      if (doc.getTextWidth(det) > maxDet) {
        while (doc.getTextWidth(det + '…') > maxDet && det.length > 0) det = det.slice(0, -1);
        det += '…';
      }
      doc.text(det, colX[2] + 3, y + 5);

      // P. unitario
      doc.setTextColor(...MUTED);
      doc.text(this.formatearPeso(item.precioUnitario), colX[3] + colWidths[3] - 3, y + 5, { align: 'right' });

      // Total fila
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...TEXT);
      doc.text(this.formatearPeso(item.total), colX[4] + colWidths[4] - 3, y + 5, { align: 'right' });

      y += ROW_H;
      if (y > PH - 55) { doc.addPage(); y = 20; }
    });

    y += 4;

    // Línea cierre tabla
    doc.setDrawColor(...ACCENT);
    doc.setLineWidth(0.5);
    doc.line(ML, y, ML + CW, y);
    y += 6;

    /* ══════════════════════════════════════════
       TOTAL GENERAL — solo borde, sin relleno oscuro
       ══════════════════════════════════════════ */
    const TB_W = 82, TB_H = 13, TB_X = ML + CW - TB_W;
    doc.setDrawColor(...ACCENT);
    doc.setLineWidth(0.5);
    doc.roundedRect(TB_X, y, TB_W, TB_H, 2, 2, 'S');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(...MUTED);
    doc.text('TOTAL PRESUPUESTO', TB_X + 4, y + 5.5);

    doc.setFontSize(13);
    doc.setTextColor(...ACCENT);
    doc.text(this.formatearPeso(totalGeneral), TB_X + TB_W - 4, y + 10.5, { align: 'right' });
    y += TB_H + 9;

    /* ══════════════════════════════════════════
       VALIDEZ
       ══════════════════════════════════════════ */
    doc.setFillColor(...SURFACE);
    doc.roundedRect(ML, y, CW, 15, 2, 2, 'F');
    doc.setDrawColor(...BORDER);
    doc.setLineWidth(0.3);
    doc.roundedRect(ML, y, CW, 15, 2, 2, 'S');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(...MUTED);
    doc.text('VALIDEZ DEL PRESUPUESTO', ML + 5, y + 5.5);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...TEXT);
    doc.text(
      `Válido por ${validez} día${validez !== 1 ? 's' : ''} desde la fecha de emisión.`,
      ML + 5, y + 11.5
    );
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...ACCENT);
    doc.text(`Vence: ${fechaVenceDisplay}`, PW - MR, y + 11.5, { align: 'right' });
    y += 22;

    /* ══════════════════════════════════════════
       OBSERVACIONES
       ══════════════════════════════════════════ */
    if (observaciones) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(...MUTED);
      doc.text('OBSERVACIONES / CONDICIONES', ML, y);
      y += 5;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(...TEXT);
      const lineas = doc.splitTextToSize(observaciones, CW);
      doc.text(lineas, ML, y);
      y += lineas.length * 5 + 4;
    }

    /* ══════════════════════════════════════════
       PIE DE PÁGINA
       ══════════════════════════════════════════ */
    const footY = PH - 11;
    doc.setDrawColor(...BORDER);
    doc.setLineWidth(0.3);
    doc.line(ML, footY - 4, PW - MR, footY - 4);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...MUTED);
    doc.text('Taller Dico Racing — Sistema de Gestión', ML, footY);
    doc.text(`${numPres} · ${fechaDisplay}`, PW - MR, footY, { align: 'right' });

    // Línea de acento inferior
    doc.setDrawColor(...ACCENT);
    doc.setLineWidth(1.2);
    doc.line(0, PH, PW, PH);

    const nombreArchivo = `Presupuesto_${numPres}_${(cliente || 'Cliente').replace(/\s+/g, '_')}.pdf`;
    return { doc, nombreArchivo };
  },

  /** Abre el modal de previsualización con el PDF renderizado en un iframe */
  previsualizarPDF() {
    const datos = this._leerFormulario();
    if (!datos) return;
    const { doc, nombreArchivo } = this._generarDoc(datos);

    // Genera el blob URL del PDF para mostrarlo en el iframe
    const blob   = doc.output('blob');
    const url    = URL.createObjectURL(blob);

    // Guarda el nombre para el botón de descarga dentro del modal
    Presupuesto._previewNombre   = nombreArchivo;
    Presupuesto._previewBlob     = blob;
    Presupuesto._previewUrl      = url;

    const iframe = document.getElementById('pdfPreviewFrame');
    if (iframe) iframe.src = url;

    const titulo = document.getElementById('pdfPreviewTitle');
    if (titulo) titulo.textContent = nombreArchivo;

    document.getElementById('modalPdfPreview').hidden = false;
    document.body.style.overflow = 'hidden';
  },

  /** Descarga el PDF directamente (sin previsualizar) */
  exportarPDF() {
    const datos = this._leerFormulario();
    if (!datos) return;
    const { doc, nombreArchivo } = this._generarDoc(datos);
    doc.save(nombreArchivo);
    mostrarToast(`PDF descargado: ${nombreArchivo}`, 'success');
  },
};

/* ╔══════════════════════════════════════════════════╗
   ║  NAVEGACIÓN SPA                                 ║
   ╚══════════════════════════════════════════════════╝ */

function navegarA(seccion) {
  document.querySelectorAll('.section').forEach(s => s.classList.add('hidden'));

  const target = document.getElementById(`section-${seccion}`);
  if (target) {
    target.classList.remove('hidden');
    if (seccion === 'clientes')    UI.renderizarTablaClientes();
    if (seccion === 'vehiculos')   UI.renderizarTablaVehiculos();
    // El módulo de presupuesto se inicializa la primera vez que se visita
    if (seccion === 'presupuesto') Presupuesto.init();
  }

  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.section === seccion);
    btn.setAttribute('aria-current', btn.dataset.section === seccion ? 'page' : 'false');
  });
}


/* ╔══════════════════════════════════════════════════╗
   ║  LÓGICA DE NEGOCIO (App)                        ║
   ╚══════════════════════════════════════════════════╝ */

const App = {

  /** ID del cliente seleccionado en el modal de detalles */
  clienteActivoId: null,

  /** ID del vehículo cuyo historial está abierto */
  vehiculoActivoId: null,

  /** ID del servicio seleccionado en el modal de detalle */
  servicioActivoId: null,

  /* ── CLIENTES ── */

  async guardarCliente(e) {
    e.preventDefault();
    const idInput = document.getElementById('inputClienteId');

    const datos = {
      Nombre:    document.getElementById('inputNombre').value.trim(),
      Telefono1: document.getElementById('inputTel1').value.trim(),
      Telefono2: document.getElementById('inputTel2').value.trim(),
      Email:     document.getElementById('inputEmail').value.trim(),
    };

    if (!datos.Nombre || !datos.Telefono1) {
      mostrarToast('Por favor completá los campos obligatorios.', 'error');
      if (!datos.Nombre)    document.getElementById('inputNombre').classList.add('error');
      if (!datos.Telefono1) document.getElementById('inputTel1').classList.add('error');
      return;
    }

    const esEdicion = idInput.value !== '';

    try {
      const btnSubmit = document.querySelector('#formCliente [type="submit"]');
      if (btnSubmit) { btnSubmit.disabled = true; btnSubmit.textContent = 'Guardando…'; }

      if (esEdicion) {
        await DataStore.actualizarCliente(idInput.value, datos);
        mostrarToast('Cliente actualizado correctamente.', 'success');
      } else {
        await DataStore.agregarCliente(datos);
        mostrarToast('Cliente agregado exitosamente.', 'success');
      }

      Modal.cerrar('modalCliente');
      Modal.limpiarFormulario('formCliente');
      UI.renderizarTablaClientes(document.getElementById('searchClientes').value);

    } catch (err) {
      mostrarToast(`Error al guardar: ${err.message}`, 'error');
      console.error('guardarCliente:', err);
    } finally {
      const btnSubmit = document.querySelector('#formCliente [type="submit"]');
      if (btnSubmit) { btnSubmit.disabled = false; btnSubmit.innerHTML = '<i data-lucide="save"></i> Guardar'; lucide.createIcons({ nodes: [btnSubmit] }); }
    }
  },

  async abrirEdicionCliente(idCliente) {
    const cliente = await DataStore.getClientePorId(idCliente);
    if (!cliente) return;

    document.getElementById('inputClienteId').value = cliente.ID_Cliente;
    document.getElementById('inputNombre').value    = cliente.Nombre;
    document.getElementById('inputTel1').value      = cliente.Telefono1 || cliente.Telefono || '';
    document.getElementById('inputTel2').value      = cliente.Telefono2 || cliente.Direccion || '';
    document.getElementById('inputEmail').value     = cliente.Email || '';

    document.getElementById('modalClienteTitle').textContent = 'Editar Cliente';
    Modal.cerrar('modalDetalleCliente');
    Modal.abrir('modalCliente');
  },

  async abrirDetalleCliente(idCliente) {
    const cliente = await DataStore.getClientePorId(idCliente);
    if (!cliente) return;

    App.clienteActivoId = idCliente;
    UI.renderizarFichaCliente(cliente);
    UI.renderizarVehiculosDeCliente(idCliente);

    document.getElementById('modalDetalleTitle').textContent = `Ficha: ${cliente.Nombre}`;
    Modal.abrir('modalDetalleCliente');
    lucide.createIcons();
  },

  async eliminarClienteActivo() {
    if (!App.clienteActivoId) return;

    const cliente = await DataStore.getClientePorId(App.clienteActivoId);
    if (!cliente) return;

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

  async guardarVehiculo(e) {
    e.preventDefault();

    const idInput  = document.getElementById('inputVehiculoId');
    const esEdicion = idInput.value !== '';

    const datos = {
      ID_Cliente: document.getElementById('inputClienteVehiculo').value,
      Patente:    document.getElementById('inputPatente').value.trim().toUpperCase(),
      Marca:      document.getElementById('inputMarca').value.trim(),
      Modelo:     document.getElementById('inputModelo').value.trim(),
      Año:        parseInt(document.getElementById('inputAnio').value, 10) || null,
      Color:      document.getElementById('inputColor').value.trim(),
    };

    if (!datos.Patente || !datos.Marca || !datos.Modelo || !datos.ID_Cliente) {
      mostrarToast('Completá todos los campos obligatorios.', 'error');
      return;
    }

    try {
      const btnSubmit = document.querySelector('#formVehiculo [type="submit"]');
      if (btnSubmit) { btnSubmit.disabled = true; btnSubmit.textContent = 'Guardando…'; }

      if (esEdicion) {
        await DataStore.actualizarVehiculo(idInput.value, datos);
        mostrarToast('Vehículo actualizado correctamente.', 'success');
      } else {
        await DataStore.agregarVehiculo(datos);
        mostrarToast('Vehículo registrado correctamente.', 'success');
      }

      Modal.cerrar('modalVehiculo');
      Modal.limpiarFormulario('formVehiculo');
      UI.renderizarTablaVehiculos(document.getElementById('searchVehiculos').value);

    } catch (err) {
      mostrarToast(`Error al guardar vehículo: ${err.message}`, 'error');
      console.error('guardarVehiculo:', err);
    } finally {
      const btnSubmit = document.querySelector('#formVehiculo [type="submit"]');
      if (btnSubmit) { btnSubmit.disabled = false; btnSubmit.innerHTML = '<i data-lucide="save"></i> Guardar'; lucide.createIcons({ nodes: [btnSubmit] }); }
    }
  },

  /**
   * Abre el formulario de vehículo en modo EDICIÓN pre-cargado.
   * Se puede llamar desde la tabla de vehículos o desde el modal de historial.
   * @param {string} idVehiculo
   */
  async abrirEdicionVehiculo(idVehiculo) {
    const vehiculos = await DataStore.getVehiculosActivos();
    const vehiculo  = vehiculos.find(v => v.ID_Vehiculo === idVehiculo);
    if (!vehiculo) return;

    // Pre-rellena el formulario con los datos actuales
    document.getElementById('inputVehiculoId').value        = vehiculo.ID_Vehiculo;
    document.getElementById('inputPatente').value           = vehiculo.Patente  || '';
    document.getElementById('inputMarca').value             = vehiculo.Marca    || '';
    document.getElementById('inputModelo').value            = vehiculo.Modelo   || '';
    document.getElementById('inputAnio').value              = vehiculo.Año      || '';
    document.getElementById('inputColor').value             = vehiculo.Color    || '';

    // Puebla el select y selecciona el cliente actual
    await UI.poblarSelectClientes();
    document.getElementById('inputClienteVehiculo').value   = vehiculo.ID_Cliente || '';

    document.getElementById('modalVehiculoTitle').textContent = 'Editar Vehículo';
    Modal.abrir('modalVehiculo');
  },

  /* ── HISTORIAL DE SERVICIOS ── */

  /**
   * Abre el modal de historial para el vehículo indicado.
   * Carga el historial y muestra el título con los datos del vehículo.
   * @param {string} idVehiculo
   */
  async abrirHistorialVehiculo(idVehiculo) {
    App.vehiculoActivoId = idVehiculo;

    // Busca los datos del vehículo para el título del modal
    const vehiculos = await DataStore.getVehiculosActivos();
    const vehiculo = vehiculos.find(v => v.ID_Vehiculo === idVehiculo);

    if (vehiculo) {
      document.getElementById('modalHistorialTitle').textContent =
        `Historial — ${vehiculo.Patente}`;
      document.getElementById('modalHistorialSubtitle').textContent =
        `${vehiculo.Marca} ${vehiculo.Modelo}${vehiculo.Año ? ' · ' + vehiculo.Año : ''}${vehiculo.Color ? ' · ' + vehiculo.Color : ''}`;
    }

    Modal.abrir('modalHistorial');

    // Carga la tabla de servicios
    await UI.renderizarTablaHistorial(idVehiculo);
    lucide.createIcons();
  },

  /**
   * Abre el modal de detalle completo de un servicio específico.
   * Se activa haciendo clic en cualquier fila de la tabla del historial.
   * @param {string} idServicio
   * @param {string} idVehiculo
   */
  async abrirDetalleServicio(idServicio, idVehiculo) {
    // Busca el servicio en el caché local del historial
    const servicios = await DataStore.getHistorialActivoPorVehiculo(idVehiculo);
    const servicio  = servicios.find(s => s.ID_Servicio === idServicio);
    if (!servicio) return;

    // Actualiza el título del modal con el ID del servicio
    document.getElementById('modalDetalleServicioTitle').textContent =
      `Servicio ${servicio.ID_Servicio}`;

    // Renderiza el contenido del detalle
    UI.renderizarDetalleServicio(servicio, idVehiculo);

    Modal.abrir('modalDetalleServicio');
    lucide.createIcons();
  },

  /**
   * Abre el formulario para CREAR un nuevo servicio.
   * Pre-llena la fecha con hoy y el ID del vehículo actual.
   */
  abrirNuevoServicio() {
    if (!App.vehiculoActivoId) return;

    Modal.limpiarFormulario('formServicio');

    // Pre-llena la fecha con hoy para comodidad del usuario
    const hoy = new Date().toISOString().split('T')[0];
    document.getElementById('inputFecha').value = hoy;

    // Asocia el servicio al vehículo activo
    document.getElementById('inputServicioVehiculoId').value = App.vehiculoActivoId;
    document.getElementById('inputServicioId').value = '';

    document.getElementById('modalServicioTitle').textContent = 'Nuevo Servicio';
    Modal.abrir('modalServicio');
  },

  /**
   * Abre el formulario en modo EDICIÓN para un servicio existente.
   * Pre-rellena todos los campos con los datos actuales.
   * @param {string} idServicio
   * @param {string} idVehiculo
   */
  async abrirEdicionServicio(idServicio, idVehiculo) {
    const servicios = await DataStore.getHistorialActivoPorVehiculo(idVehiculo);
    const servicio  = servicios.find(s => s.ID_Servicio === idServicio);
    if (!servicio) return;

    // Cierra el modal de detalle si estaba abierto
    Modal.cerrar('modalDetalleServicio');

    // Pre-rellena el formulario con los datos del servicio
    document.getElementById('inputServicioId').value           = servicio.ID_Servicio;
    document.getElementById('inputServicioVehiculoId').value   = idVehiculo;
    document.getElementById('inputFecha').value                = servicio.Fecha?.split('T')[0] || '';
    document.getElementById('inputKM').value                   = servicio.KM || '';
    document.getElementById('inputDescripcion').value          = servicio.Descripcion_Trabajo || '';
    document.getElementById('inputCosto').value                = servicio.Costo || '';

    document.getElementById('modalServicioTitle').textContent = 'Editar Servicio';
    Modal.abrir('modalServicio');
  },

  /**
   * Guarda un servicio (nuevo o editado) desde el formulario.
   * Distingue entre modo creación y edición por el campo oculto inputServicioId.
   * @param {Event} e
   */
  async guardarServicio(e) {
    e.preventDefault();

    const idServicio  = document.getElementById('inputServicioId').value;
    const idVehiculo  = document.getElementById('inputServicioVehiculoId').value;
    const esEdicion   = idServicio !== '';

    const datos = {
      ID_Vehiculo:        idVehiculo,
      Fecha:              document.getElementById('inputFecha').value,
      KM:                 parseInt(document.getElementById('inputKM').value, 10) || null,
      Descripcion_Trabajo: document.getElementById('inputDescripcion').value.trim(),
      Costo:              parseFloat(document.getElementById('inputCosto').value) || null,
    };

    // Validaciones de campos requeridos
    if (!datos.Fecha || !datos.Descripcion_Trabajo) {
      mostrarToast('Completá los campos obligatorios (Fecha y Descripción).', 'error');
      if (!datos.Fecha)               document.getElementById('inputFecha').classList.add('error');
      if (!datos.Descripcion_Trabajo) document.getElementById('inputDescripcion').classList.add('error');
      return;
    }

    if (!datos.KM || datos.KM <= 0) {
      mostrarToast('Ingresá un kilometraje válido.', 'error');
      document.getElementById('inputKM').classList.add('error');
      return;
    }

    try {
      const btnSubmit = document.querySelector('#formServicio [type="submit"]');
      if (btnSubmit) { btnSubmit.disabled = true; btnSubmit.textContent = 'Guardando…'; }

      if (esEdicion) {
        // Modo edición: actualiza el registro existente
        await DataStore.actualizarServicio(idServicio, idVehiculo, datos);
        mostrarToast('Servicio actualizado correctamente.', 'success');
      } else {
        // Modo creación: agrega un nuevo registro
        await DataStore.agregarServicio(datos);
        mostrarToast('Servicio registrado correctamente.', 'success');
      }

      Modal.cerrar('modalServicio');
      Modal.limpiarFormulario('formServicio');

      // Refresca la tabla del historial
      await UI.renderizarTablaHistorial(idVehiculo);
      lucide.createIcons();

    } catch (err) {
      mostrarToast(`Error al guardar servicio: ${err.message}`, 'error');
      console.error('guardarServicio:', err);
    } finally {
      const btnSubmit = document.querySelector('#formServicio [type="submit"]');
      if (btnSubmit) { btnSubmit.disabled = false; btnSubmit.innerHTML = '<i data-lucide="save"></i> Guardar'; lucide.createIcons({ nodes: [btnSubmit] }); }
    }
  },

  /**
   * Borrado lógico de un servicio.
   * Cambia el Estado a 'Eliminado' en el Sheet. NO borra la fila.
   * El servicio desaparece de la UI pero se conserva para auditoría.
   * @param {string} idServicio
   * @param {string} idVehiculo
   */
  async eliminarServicio(idServicio, idVehiculo) {
    const confirmar = window.confirm(
      `¿Eliminar este registro de servicio?\nEl registro se marcará como "Eliminado" en el historial pero no se borrará del Sheet.`
    );
    if (!confirmar) return;

    try {
      await DataStore.eliminarServicioLogico(idServicio, idVehiculo);
      mostrarToast('Servicio eliminado del historial.', 'info');

      // Si estaba abierto el modal de detalle, lo cierra
      Modal.cerrar('modalDetalleServicio');

      // Refresca la tabla del historial
      await UI.renderizarTablaHistorial(idVehiculo);
      lucide.createIcons();

    } catch (err) {
      mostrarToast(`Error al eliminar: ${err.message}`, 'error');
      console.error('eliminarServicio:', err);
    }
  },
};


/* ╔══════════════════════════════════════════════════╗
   ║  UTILIDADES                                     ║
   ╚══════════════════════════════════════════════════╝ */

/**
 * Escapa caracteres HTML para prevenir XSS.
 * Siempre usarlo al insertar strings del usuario en el DOM.
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
 * Retarda la ejecución de fn hasta que pasen `espera` ms sin nuevas llamadas.
 * Útil para la búsqueda en tiempo real sin saturar llamadas al Sheet.
 * @param {Function} fn
 * @param {number} espera - ms
 */
function debounce(fn, espera = 250) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), espera);
  };
}

/**
 * Formatea una fecha para mostrarla en formato legible en Argentina.
 * Acepta strings ISO (2025-03-15), strings con barras (15/03/2025) y objetos Date.
 * @param {string|Date} fecha
 * @returns {string} Fecha formateada o el valor original si falla
 */
function formatearFecha(fecha) {
  if (!fecha) return '—';
  try {
    // Manejo especial de formato dd/mm/yyyy que ya viene del Sheet
    if (typeof fecha === 'string' && /^\d{2}\/\d{2}\/\d{4}$/.test(fecha)) {
      return fecha; // Ya está en formato legible
    }
    // Para formatos ISO (yyyy-mm-dd) o Date objects
    const d = new Date(fecha);
    if (isNaN(d.getTime())) return String(fecha);
    return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  } catch {
    return String(fecha);
  }
}


/* ╔══════════════════════════════════════════════════╗
   ║  INICIALIZACIÓN                                 ║
   ╚══════════════════════════════════════════════════╝ */

function init() {

  // Inicializar íconos Lucide SVG
  lucide.createIcons();

  // ── NAVEGACIÓN SPA ──
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => navegarA(btn.dataset.section));
  });

  // ── BÚSQUEDA EN TIEMPO REAL (con debounce para no saturar el Sheet) ──
  const buscarClientes  = debounce(e => UI.renderizarTablaClientes(e.target.value), 400);
  const buscarVehiculos = debounce(e => UI.renderizarTablaVehiculos(e.target.value), 400);

  document.getElementById('searchClientes')?.addEventListener('input', buscarClientes);
  document.getElementById('searchVehiculos')?.addEventListener('input', buscarVehiculos);

  // ── CLIENTES ──
  document.getElementById('btnAgregarCliente')?.addEventListener('click', () => {
    Modal.limpiarFormulario('formCliente');
    document.getElementById('inputClienteId').value = '';
    document.getElementById('modalClienteTitle').textContent = 'Nuevo Cliente';
    Modal.abrir('modalCliente');
  });

  document.getElementById('formCliente')?.addEventListener('submit', App.guardarCliente);

  // Limpia el estilo de error al escribir
  document.querySelectorAll('#formCliente input').forEach(input => {
    input.addEventListener('input', () => input.classList.remove('error'));
  });

  // Botones del modal de detalles de cliente
  document.getElementById('btnEditarClienteDetalle')?.addEventListener('click', () => {
    if (App.clienteActivoId) App.abrirEdicionCliente(App.clienteActivoId);
  });

  document.getElementById('btnEliminarClienteDetalle')?.addEventListener('click',
    App.eliminarClienteActivo
  );

  // ── VEHÍCULOS ──
  document.getElementById('btnAgregarVehiculo')?.addEventListener('click', () => {
    Modal.limpiarFormulario('formVehiculo');
    document.getElementById('inputVehiculoId').value = '';
    UI.poblarSelectClientes();
    Modal.abrir('modalVehiculo');
  });

  document.getElementById('formVehiculo')?.addEventListener('submit', App.guardarVehiculo);

  // ── HISTORIAL DE SERVICIOS ──

  // Botón "Nuevo Servicio" dentro del modal de historial
  document.getElementById('btnNuevoServicio')?.addEventListener('click', () => {
    App.abrirNuevoServicio();
  });

  // Formulario de servicio (crea o edita según inputServicioId)
  document.getElementById('formServicio')?.addEventListener('submit', App.guardarServicio);

  // Limpia errores al escribir en el formulario de servicio
  document.querySelectorAll('#formServicio input, #formServicio textarea').forEach(el => {
    el.addEventListener('input', () => el.classList.remove('error'));
  });

  // Botón editar desde el modal de detalle del servicio
  document.getElementById('btnEditarServicio')?.addEventListener('click', () => {
    if (App.servicioActivoId && App.vehiculoActivoId) {
      App.abrirEdicionServicio(App.servicioActivoId, App.vehiculoActivoId);
    }
  });

  // Botón eliminar desde el modal de detalle del servicio
  document.getElementById('btnEliminarServicio')?.addEventListener('click', () => {
    if (App.servicioActivoId && App.vehiculoActivoId) {
      App.eliminarServicio(App.servicioActivoId, App.vehiculoActivoId);
    }
  });

  // ── CIERRE DE MODALES ──

  // Botones con data-close="<id-modal>"
  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => Modal.cerrar(btn.dataset.close));
  });

  // Clic en el overlay oscuro (fuera del contenido del modal)
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', e => {
      if (e.target === overlay) Modal.cerrar(overlay.id);
    });
  });

  // Tecla Escape: cierra el modal más al frente (el último visible)
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    // Prioriza el modal de detalle de servicio si está abierto
    const modalesAbiertos = [
      'modalDetalleServicio',
      'modalServicio',
      'modalHistorial',
      'modalDetalleCliente',
      'modalCliente',
      'modalVehiculo',
    ];
    for (const id of modalesAbiertos) {
      const el = document.getElementById(id);
      if (el && !el.hidden) {
        Modal.cerrar(id);
        break;
      }
    }
  });

  // ── MODAL DE PREVISUALIZACIÓN PDF ──
  document.getElementById('btnCerrarPreview')?.addEventListener('click', () => {
    document.getElementById('modalPdfPreview').hidden = true;
    document.body.style.overflow = '';
    // Libera el blob URL para no acumular memoria
    if (Presupuesto._previewUrl) {
      URL.revokeObjectURL(Presupuesto._previewUrl);
      Presupuesto._previewUrl = null;
    }
  });

  document.getElementById('btnDescargarDesdePreview')?.addEventListener('click', () => {
    if (!Presupuesto._previewBlob || !Presupuesto._previewNombre) return;
    // Descarga usando un <a> temporal con el blob ya generado (no recalcula el PDF)
    const a = document.createElement('a');
    a.href = URL.createObjectURL(Presupuesto._previewBlob);
    a.download = Presupuesto._previewNombre;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    mostrarToast(`Descargando: ${Presupuesto._previewNombre}`, 'success');
  });

  // Cerrar preview al hacer clic en el overlay (fuera del modal)
  document.getElementById('modalPdfPreview')?.addEventListener('click', (e) => {
    if (e.target.id === 'modalPdfPreview') {
      document.getElementById('btnCerrarPreview')?.click();
    }
  });

  // ── TOGGLE DE TEMA (oscuro / claro) ──
  const btnTheme   = document.getElementById('btnThemeToggle');
  const themeLabel = document.getElementById('themeLabel');

  // Recupera el tema guardado en localStorage (persiste entre sesiones)
  const temaGuardado = localStorage.getItem('tallerTema') || 'dark';
  aplicarTema(temaGuardado);

  btnTheme?.addEventListener('click', () => {
    const esClaro = document.documentElement.classList.contains('light');
    aplicarTema(esClaro ? 'dark' : 'light');
  });

  /**
   * Aplica el tema indicado al <html> y actualiza el botón.
   * Guarda la preferencia en localStorage para recordarla.
   * @param {'dark'|'light'} tema
   */
  function aplicarTema(tema) {
    const esClaro = tema === 'light';
    document.documentElement.classList.toggle('light', esClaro);
    localStorage.setItem('tallerTema', tema);

    // Actualiza el ícono y label del botón según el tema activo
    if (themeLabel) themeLabel.textContent = esClaro ? 'Tema oscuro' : 'Tema claro';

    // Cambia el ícono: sol → luna en claro, luna → sol en oscuro
    const iconEl = btnTheme?.querySelector('i[data-lucide]');
    if (iconEl) {
      iconEl.setAttribute('data-lucide', esClaro ? 'moon' : 'sun');
      lucide.createIcons({ nodes: [btnTheme] });
    }
  }

  // ── RENDERIZADO INICIAL ──
  navegarA('clientes');

  console.info('Taller Dico — Sistema iniciado. Conectado a GAS →', GAS_URL);
}

// Espera a que el DOM esté completamente listo antes de inicializar
document.addEventListener('DOMContentLoaded', init);
