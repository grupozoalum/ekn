/* ═══════════════════════════════════════════════════════════════
   EIKON diseño & publicidad — tienda en línea
   Firebase: Auth + Firestore + Storage
   ═══════════════════════════════════════════════════════════════ */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, signOut, sendPasswordResetEmail
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  getFirestore, collection, doc, onSnapshot, getDocs, setDoc, updateDoc,
  deleteDoc, query, where, serverTimestamp, writeBatch
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import {
  getStorage, ref as sref, uploadBytesResumable, getDownloadURL, deleteObject
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js';

/* ── Configuración ──────────────────────────────────────────── */
const firebaseConfig = {
  apiKey: "AIzaSyC0CL30o2pBoT4-hLjUH0TQ_1R6F2jds40",
  authDomain: "incidencias-365ab.firebaseapp.com",
  projectId: "incidencias-365ab",
  storageBucket: "incidencias-365ab.firebasestorage.app",
  messagingSenderId: "904936384451",
  appId: "1:904936384451:web:6adec3c77d43a9a7857f76",
  measurementId: "G-H72EHHZ2S6"
};

/* IMPORTANTE — sobre el acceso de administrador
   ─────────────────────────────────────────────
   Este UID NO es la seguridad del sistema: cualquier persona puede leer
   este archivo. La seguridad real vive en las reglas de Firestore y Storage
   (ver el archivo firebase-reglas.txt que acompaña a este proyecto).
   Aquí solo se usa para decidir qué se le muestra al administrador.

   La entrada al panel ya no aparece en el pie de página. Para entrar:
     · escribe  #/taller  al final de la dirección, o
     · presiona  Ctrl + Alt + E, o
     · haz 5 clics seguidos sobre el año del pie de página.
   Cualquiera de las tres abre la ventana normal de acceso; sin el correo
   del administrador no pasa nada. */
const ADMIN_UID = "Yk42FPVE0ycH4QnUqPi1ZuG0meG3";
const LLAVE_PANEL = '#/taller';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

const COL_PROD = 'productos';
const COL_CAT = 'categorias';
const COL_PED = 'pedidos';
const DOC_CONFIG = doc(db, 'config', 'general');
const MAX_ARCHIVO = 25 * 1024 * 1024;

/* ── Utilidades ─────────────────────────────────────────────── */
const $ = (sel, raiz = document) => raiz.querySelector(sel);
const $$ = (sel, raiz = document) => [...raiz.querySelectorAll(sel)];
const pesos = n => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(Number(n) || 0);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const slug = s => String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 48);
const kb = b => b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';

const UNIDADES = {
  pieza: 'por pieza', ciento: 'por ciento', millar: 'por millar',
  m2: 'por m²', paquete: 'por paquete', juego: 'por juego', servicio: 'por servicio'
};
const PLURALES = {
  pieza: 'piezas', ciento: 'cientos', millar: 'millares',
  m2: 'm²', paquete: 'paquetes', juego: 'juegos', servicio: 'servicios'
};
const plural = (u, n) => n === 1 ? (u === 'm2' ? 'm²' : (u || 'pieza')) : (PLURALES[u] || 'piezas');

function aviso(texto, tipo = '') {
  const n = document.createElement('div');
  n.className = 'aviso' + (tipo ? ' aviso--' + tipo : '');
  n.textContent = texto;
  $('#avisos').appendChild(n);
  setTimeout(() => n.remove(), 4600);
}

function abrir(id) {
  const capa = document.getElementById(id);
  capa.classList.remove('oculto');
  document.body.style.overflow = 'hidden';
  const foco = capa.querySelector('input:not([type=hidden]):not([readonly]):not([tabindex="-1"]), select, textarea, button:not(.cerrar)');
  if (foco) setTimeout(() => foco.focus({ preventScroll: true }), 60);
}
function cerrar(capa) {
  capa?.classList.add('oculto');
  if (!$$('.capa:not(.oculto)').length) document.body.style.overflow = '';
}
document.addEventListener('click', e => {
  if (e.target.closest('[data-cerrar]')) cerrar(e.target.closest('.capa'));
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { const c = $$('.capa:not(.oculto)').pop(); if (c) cerrar(c); }
});
const abierto = id => !document.getElementById(id).classList.contains('oculto');

/* ── Estado ─────────────────────────────────────────────────── */
const estado = {
  productos: [], categorias: [], pedidos: [], config: {},
  carrito: cargarCarrito(),
  usuario: null, esAdmin: false,
  filtro: { cat: '', q: '', orden: 'destacados' },
  seleccion: new Set(),
  cargando: true
};
let accionPendiente = null;

function cargarCarrito() {
  try { return JSON.parse(localStorage.getItem('eikon_carrito') || '[]'); } catch { return []; }
}
function guardarCarrito() {
  try { localStorage.setItem('eikon_carrito', JSON.stringify(estado.carrito)); } catch {}
}

/* ═══════════════════════════════════════════════════════════
   1. DATOS EN VIVO
   ═══════════════════════════════════════════════════════════ */
onSnapshot(collection(db, COL_PROD), snap => {
  estado.productos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  estado.cargando = false;
  pintarCatalogo(); pintarNavCats(); pintarTablaProductos(); pintarListaCatsAdmin();
}, err => {
  estado.cargando = false; console.error(err);
  $('#rejilla').innerHTML = '';
  mostrarVacio('No pudimos cargar el catálogo', 'Revisa tu conexión y vuelve a cargar la página. Si el problema sigue, escríbenos por WhatsApp y tomamos tu pedido ahí mismo.');
});

onSnapshot(collection(db, COL_CAT), snap => {
  estado.categorias = snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (a.orden ?? 99) - (b.orden ?? 99) || String(a.nombre).localeCompare(b.nombre));
  pintarNavCats(); pintarSelectsCategorias(); pintarListaCatsAdmin();
  pintarCatalogo(); pintarTablaProductos();
}, err => console.error(err));

onSnapshot(DOC_CONFIG, snap => {
  estado.config = snap.exists() ? snap.data() : {};
  aplicarConfig();
}, err => console.error(err));

let desuscribirPedidos = null;
function escucharPedidos() {
  if (desuscribirPedidos) return;
  desuscribirPedidos = onSnapshot(collection(db, COL_PED), snap => {
    estado.pedidos = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.creado?.seconds || 0) - (a.creado?.seconds || 0));
    pintarPedidos();
  }, err => console.error('pedidos', err));
}

function aplicarConfig() {
  const c = estado.config;
  const tel = c.telefono || '771 000 0000';
  $('#cintaTel').textContent = 'Tel. ' + tel;
  $('#cintaTel').href = 'tel:' + tel.replace(/\s/g, '');
  $('#cintaEnvio').textContent = c.aviso || 'Entregas en Tizayuca y zona metropolitana';
  if (c.heroTitulo) $('#heroTitulo').textContent = c.heroTitulo;
  if (c.heroSub) $('#heroSub').textContent = c.heroSub;
  $('#pieTel').textContent = tel;
  $('#pieMail').textContent = c.email || 'ventas@eikon.mx';
  $('#pieDir').textContent = c.direccion || 'Tizayuca, Hidalgo';
  $('#pieHorario').textContent = c.horario || 'Lun a Vie 9:00–18:00 · Sáb 9:00–14:00';

  const liga = ligaWhats('Hola EIKON, quiero información sobre sus servicios.');
  ['#pieWhats', '#cintaWhats', '#ctaWhats', '#fabWhats'].forEach(s => { const el = $(s); if (el) el.href = liga; });

  const f = $('#formAjustes');
  ['telefono', 'whatsapp', 'email', 'direccion', 'horario', 'aviso', 'heroTitulo', 'heroSub']
    .forEach(k => { if (f[k] && document.activeElement !== f[k]) f[k].value = c[k] || ''; });
}
const ligaWhats = texto =>
  `https://wa.me/${(estado.config.whatsapp || '527710000000').replace(/\D/g, '')}?text=${encodeURIComponent(texto)}`;
$('#anio').textContent = new Date().getFullYear();

/* ═══════════════════════════════════════════════════════════
   2. CATÁLOGO
   ═══════════════════════════════════════════════════════════ */
const catPorId = id => estado.categorias.find(c => c.id === id);
const nombreCat = id => catPorId(id)?.nombre || 'Sin categoría';
const portada = p => p.imagenes?.[0]?.url || '';

function precioTexto(p) {
  if (p.cotizacion || p.precio == null || p.precio === '')
    return `<span class="precio precio--cotiza">Cotización a medida</span>`;
  return `<span class="precio">${p.precioDesde ? 'Desde ' : ''}${pesos(p.precio)}
    <small>${UNIDADES[p.unidad] || 'por pieza'}</small></span>`;
}

function productosVisibles() {
  const { cat, q, orden } = estado.filtro;
  const catsOcultas = new Set(estado.categorias.filter(c => c.activa === false).map(c => c.id));
  let lista = estado.productos.filter(p =>
    estado.esAdmin || (p.activo !== false && !catsOcultas.has(p.categoria)));
  if (cat) lista = lista.filter(p => p.categoria === cat);
  if (q) {
    const t = q.toLowerCase();
    lista = lista.filter(p => [p.nombre, p.descripcion, p.descripcionCorta, p.sku, nombreCat(p.categoria)]
      .join(' ').toLowerCase().includes(t));
  }
  const num = p => (p.cotizacion || p.precio == null) ? Infinity : Number(p.precio);
  return lista.sort({
    'nombre': (a, b) => String(a.nombre).localeCompare(b.nombre),
    'precio-asc': (a, b) => num(a) - num(b),
    'precio-desc': (a, b) => num(b) - num(a),
    'destacados': (a, b) => (b.destacado ? 1 : 0) - (a.destacado ? 1 : 0)
      || (a.orden ?? 100) - (b.orden ?? 100) || String(a.nombre).localeCompare(b.nombre)
  }[orden]);
}

function tarjetaHTML(p) {
  const img = portada(p);
  const cotiza = p.cotizacion || p.precio == null;
  return `
  <article class="tarjeta ${p.activo === false ? 'tarjeta--oculta' : ''}" data-id="${p.id}" tabindex="0" role="button" aria-label="${esc(p.nombre || 'Producto')}">
    <div class="tarjeta__foto">
      ${img ? `<img src="${esc(img)}" alt="${esc(p.nombre)}" loading="lazy">`
            : `<div class="tarjeta__sinfoto">${esc(nombreCat(p.categoria))}</div>`}
      ${p.destacado ? '<span class="tarjeta__marca">Destacado</span>' : ''}
    </div>
    <div class="tarjeta__cuerpo">
      <p class="slug">${esc(nombreCat(p.categoria))}</p>
      <h3>${esc(p.nombre || 'Producto sin nombre')}</h3>
      <p class="tarjeta__desc">${esc(p.descripcionCorta || (p.descripcion || '').slice(0, 90))}</p>
      <div class="tarjeta__pie">
        ${precioTexto(p)}
        <button class="tarjeta__mas" type="button" data-agregar="${p.id}">${cotiza ? 'Cotizar' : 'Agregar'}</button>
      </div>
    </div>
  </article>`;
}

function pintarCatalogo() {
  const grid = $('#rejilla');
  if (estado.cargando) {
    grid.innerHTML = Array.from({ length: 8 }, () => '<div class="esqueleto"></div>').join('');
    return;
  }
  const lista = productosVisibles();
  const cat = catPorId(estado.filtro.cat);
  $('#tituloResultados').textContent = estado.filtro.q
    ? `Resultados para “${estado.filtro.q}”` : (cat ? cat.nombre : 'Catálogo completo');
  $('#conteoResultados').textContent = lista.length
    ? `${lista.length} ${lista.length === 1 ? 'producto' : 'productos'}` : '';
  $('#btnQuitarFiltro').classList.toggle('oculto', !estado.filtro.q && !estado.filtro.cat);

  if (!lista.length) {
    grid.innerHTML = '';
    return estado.productos.length
      ? mostrarVacio('Nada por aquí todavía', 'Prueba con otra categoría o pídenos una cotización a medida: casi siempre podemos hacerlo.')
      : mostrarVacio('El catálogo está vacío', estado.esAdmin
        ? 'Abre el panel y usa “Cargar catálogo de ejemplo” para empezar con productos reales.'
        : 'Estamos cargando los productos. Mientras tanto, escríbenos por WhatsApp y te atendemos directo.');
  }
  $('#vacio').classList.add('oculto');
  grid.innerHTML = lista.map(tarjetaHTML).join('');
}

function mostrarVacio(titulo, texto) {
  const v = $('#vacio');
  v.classList.remove('oculto');
  v.innerHTML = `<h3>${esc(titulo)}</h3><p>${esc(texto)}</p>`;
}

$('#rejilla').addEventListener('click', e => {
  const mas = e.target.closest('[data-agregar]');
  if (mas) {
    e.stopPropagation();
    const p = estado.productos.find(x => x.id === mas.dataset.agregar);
    if (p?.opciones?.length || p?.cotizacion || p?.precio == null) return verProducto(p.id);
    return agregarAlCarrito(p, p.minimo || 1, {});
  }
  const t = e.target.closest('.tarjeta');
  if (t) verProducto(t.dataset.id);
});
$('#rejilla').addEventListener('keydown', e => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('tarjeta')) {
    e.preventDefault(); verProducto(e.target.dataset.id);
  }
});

function pintarNavCats() {
  const cuenta = id => estado.productos.filter(p => p.categoria === id && p.activo !== false).length;
  const cats = estado.categorias.filter(c => estado.esAdmin || c.activa !== false);
  $('#navCats').innerHTML =
    `<button data-cat="" class="${estado.filtro.cat ? '' : 'activo'}">Todo</button>` +
    cats.map(c => `<button data-cat="${c.id}" class="${estado.filtro.cat === c.id ? 'activo' : ''}">${esc(c.nombre)}</button>`).join('');
  $('#listaCats').innerHTML =
    `<button data-cat="" class="${estado.filtro.cat ? '' : 'activo'}">Todo el catálogo <small>${estado.productos.filter(p => p.activo !== false).length}</small></button>` +
    cats.map(c => `<button data-cat="${c.id}" class="${estado.filtro.cat === c.id ? 'activo' : ''}">${esc(c.nombre)} <small>${cuenta(c.id)}</small></button>`).join('');
}

document.addEventListener('click', e => {
  const b = e.target.closest('#navCats button, #listaCats button');
  if (!b) return;
  estado.filtro.cat = b.dataset.cat;
  estado.filtro.q = ''; $('#inpBuscar').value = ''; $('#btnLimpiarBusca').classList.add('oculto');
  pintarNavCats(); pintarCatalogo();
  document.getElementById('catalogo').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

/* búsqueda: filtra mientras escribe, sin obligar a presionar Enter */
let tiempoBusca = null;
$('#formBuscar').addEventListener('submit', e => {
  e.preventDefault();
  aplicarBusqueda($('#inpBuscar').value.trim(), true);
});
$('#inpBuscar').addEventListener('input', e => {
  const v = e.target.value.trim();
  $('#btnLimpiarBusca').classList.toggle('oculto', !v);
  clearTimeout(tiempoBusca);
  tiempoBusca = setTimeout(() => aplicarBusqueda(v, false), 260);
});
$('#btnLimpiarBusca').addEventListener('click', () => {
  $('#inpBuscar').value = ''; $('#btnLimpiarBusca').classList.add('oculto');
  aplicarBusqueda('', false); $('#inpBuscar').focus();
});
$('#btnQuitarFiltro').addEventListener('click', () => {
  estado.filtro.cat = ''; $('#inpBuscar').value = ''; $('#btnLimpiarBusca').classList.add('oculto');
  aplicarBusqueda('', false);
});
function aplicarBusqueda(texto, saltar) {
  estado.filtro.q = texto;
  if (texto) estado.filtro.cat = '';
  pintarNavCats(); pintarCatalogo();
  if (saltar) document.getElementById('catalogo').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
$('#selOrden').addEventListener('change', e => { estado.filtro.orden = e.target.value; pintarCatalogo(); });

/* ═══════════════════════════════════════════════════════════
   3. FICHA DE PRODUCTO
   ═══════════════════════════════════════════════════════════ */
let prodActual = null;

function verProducto(id) {
  const p = estado.productos.find(x => x.id === id);
  if (!p) return;
  prodActual = p;
  $('#pvCat').textContent = nombreCat(p.categoria);
  $('#pvNombre').textContent = p.nombre;
  $('#pvPrecio').innerHTML = (p.cotizacion || p.precio == null)
    ? 'Cotización a medida'
    : `${p.precioDesde ? 'Desde ' : ''}${pesos(p.precio)} <small>${UNIDADES[p.unidad] || 'por pieza'}</small>`;
  $('#pvDesc').textContent = p.descripcion || p.descripcionCorta || '';

  const imgs = p.imagenes || [];
  const img = $('#pvImg'), caja = $('.pv__principal');
  caja.classList.toggle('pv__principal--vacio', !imgs.length);
  caja.querySelector('.pv__sinfoto')?.remove();
  if (imgs.length) { img.src = imgs[0].url; img.alt = p.nombre; img.style.display = ''; }
  else {
    img.removeAttribute('src'); img.style.display = 'none';
    caja.insertAdjacentHTML('beforeend', '<span class="pv__sinfoto">Sin fotografía todavía</span>');
  }
  $('#pvMinis').innerHTML = imgs.length > 1
    ? imgs.map((im, i) => `<img src="${esc(im.url)}" alt="" class="${i === 0 ? 'activa' : ''}">`).join('') : '';

  $('#pvOpciones').innerHTML = (p.opciones || []).map((o, i) => `
    <div><label for="opt${i}">${esc(o.nombre)}</label>
      <select class="campo" id="opt${i}" data-opt="${esc(o.nombre)}">
        ${o.valores.map(v => `<option>${esc(v)}</option>`).join('')}
      </select></div>`).join('');

  const min = p.minimo || 1;
  $('#pvCant').value = min; $('#pvCant').min = min;
  $('#pvNota').textContent = [
    min > 1 ? `Pedido mínimo: ${min} ${plural(p.unidad, min)}.` : '',
    p.sku ? `Clave ${p.sku}.` : '',
    'Si no tienes el arte listo, nosotros lo diseñamos.'
  ].filter(Boolean).join(' ');
  $('#pvAgregar').textContent = (p.cotizacion || p.precio == null) ? 'Pedir cotización' : 'Agregar al carrito';
  pintarSubtotalProducto();
  abrir('modalProducto');
}

function pintarSubtotalProducto() {
  const p = prodActual, caja = $('#pvSubtotal');
  if (!p || p.cotizacion || p.precio == null) { caja.textContent = ''; return; }
  const n = Math.max(p.minimo || 1, Number($('#pvCant').value) || 1);
  caja.innerHTML = `${n} ${plural(p.unidad, n)} · <strong>${pesos(p.precio * n)}</strong>`;
}

$('#pvMinis').addEventListener('click', e => {
  if (e.target.tagName !== 'IMG') return;
  $('#pvImg').src = e.target.src;
  $$('#pvMinis img').forEach(i => i.classList.toggle('activa', i === e.target));
});
$('#pvMenos').addEventListener('click', () => {
  const i = $('#pvCant'); i.value = Math.max(Number(i.min || 1), Number(i.value) - 1); pintarSubtotalProducto();
});
$('#pvMas').addEventListener('click', () => { const i = $('#pvCant'); i.value = Number(i.value) + 1; pintarSubtotalProducto(); });
$('#pvCant').addEventListener('input', pintarSubtotalProducto);
$('#pvCant').addEventListener('blur', e => {
  const min = Number(e.target.min || 1);
  if (Number(e.target.value) < min || !e.target.value) {
    e.target.value = min;
    aviso(`El pedido mínimo de este producto es ${min}.`);
  }
  pintarSubtotalProducto();
});
$('#pvAgregar').addEventListener('click', () => {
  const opts = {};
  $$('#pvOpciones select').forEach(s => opts[s.dataset.opt] = s.value);
  agregarAlCarrito(prodActual, Number($('#pvCant').value) || 1, opts);
  cerrar($('#modalProducto'));
});

/* ═══════════════════════════════════════════════════════════
   4. CARRITO
   ═══════════════════════════════════════════════════════════ */
function agregarAlCarrito(p, cantidad, opciones) {
  if (!p) return;
  const min = p.minimo || 1;
  cantidad = Math.max(min, Number(cantidad) || min);
  const clave = p.id + '|' + JSON.stringify(opciones);
  const existente = estado.carrito.find(i => i.clave === clave);
  if (existente) existente.cantidad += cantidad;
  else estado.carrito.push({
    clave, id: p.id, nombre: p.nombre,
    precio: (p.cotizacion || p.precio == null) ? 0 : (Number(p.precio) || 0),
    cotizacion: !!p.cotizacion || p.precio == null,
    unidad: p.unidad || 'pieza', minimo: min,
    imagen: portada(p), opciones, cantidad
  });
  guardarCarrito(); pintarCarrito();
  const pastilla = $('#cartCount');
  pastilla.classList.add('pulso');
  setTimeout(() => pastilla.classList.remove('pulso'), 450);
  aviso(`${p.nombre} se agregó a tu pedido`, 'ok');
}
const totalCarrito = () => estado.carrito.reduce((s, i) => s + i.precio * i.cantidad, 0);
const piezasCarrito = () => estado.carrito.reduce((s, i) => s + i.cantidad, 0);

function pintarCarrito() {
  const n = piezasCarrito();
  $('#cartCount').textContent = n;
  $('#cartCount').classList.toggle('oculto', !n);

  const cuerpo = $('#carritoItems');
  if (!estado.carrito.length) {
    cuerpo.innerHTML = `<div class="vacio" style="border:0;background:none;padding:52px 0">
      <h3>Tu pedido está vacío</h3><p>Elige un producto del catálogo para empezar. Si no lo encuentras, pide una cotización a medida.</p></div>`;
    $('#btnIrPagar').disabled = true;
  } else {
    $('#btnIrPagar').disabled = false;
    cuerpo.innerHTML = estado.carrito.map(i => `
      <div class="linea-carrito">
        ${i.imagen ? `<img src="${esc(i.imagen)}" alt="">` : '<div class="linea-carrito__sinfoto"></div>'}
        <div>
          <h4>${esc(i.nombre)}</h4>
          <p class="opts">${Object.entries(i.opciones || {}).map(([k, v]) => `${esc(k)}: ${esc(v)}`).join(' · ') || (i.cotizacion ? 'Por cotizar' : UNIDADES[i.unidad])}</p>
          <div class="ctrl">
            <span class="mini">
              <button type="button" data-menos="${esc(i.clave)}" aria-label="Quitar uno">−</button>
              <input type="number" min="${i.minimo}" value="${i.cantidad}" data-clave="${esc(i.clave)}" aria-label="Cantidad de ${esc(i.nombre)}">
              <button type="button" data-mas="${esc(i.clave)}" aria-label="Agregar uno">+</button>
            </span>
            <button class="quitar" data-quitar="${esc(i.clave)}" type="button">Quitar</button>
          </div>
        </div>
        <span class="monto">${i.cotizacion ? '—' : pesos(i.precio * i.cantidad)}</span>
      </div>`).join('');
  }
  $('#carritoTotal').textContent = pesos(totalCarrito());
  const hayCotiza = estado.carrito.some(i => i.cotizacion);
  $('#carritoNota').textContent = hayCotiza
    ? 'Los productos “por cotizar” no suman al subtotal. Te mandamos el precio antes de imprimir.'
    : 'Los precios no incluyen envío. Te confirmamos el total final al revisar tu arte.';
}

function cambiarCantidad(clave, delta) {
  const item = estado.carrito.find(i => i.clave === clave);
  if (!item) return;
  const min = item.minimo || 1;
  const nueva = item.cantidad + delta;
  if (nueva < min) {
    if (delta < 0 && item.cantidad === min) {
      estado.carrito = estado.carrito.filter(i => i.clave !== clave);
      guardarCarrito(); pintarCarrito();
      return aviso('Producto quitado del pedido');
    }
    item.cantidad = min;
  } else item.cantidad = nueva;
  guardarCarrito(); pintarCarrito();
}

$('#carritoItems').addEventListener('click', e => {
  const q = e.target.closest('[data-quitar]');
  if (q) {
    estado.carrito = estado.carrito.filter(i => i.clave !== q.dataset.quitar);
    guardarCarrito(); pintarCarrito();
    return;
  }
  const menos = e.target.closest('[data-menos]');
  if (menos) return cambiarCantidad(menos.dataset.menos, -1);
  const mas = e.target.closest('[data-mas]');
  if (mas) return cambiarCantidad(mas.dataset.mas, 1);
});
$('#carritoItems').addEventListener('change', e => {
  const inp = e.target.closest('input[data-clave]'); if (!inp) return;
  const item = estado.carrito.find(i => i.clave === inp.dataset.clave);
  if (!item) return;
  const min = item.minimo || 1;
  const v = Number(inp.value) || 0;
  if (v < min) aviso(`El mínimo de “${item.nombre}” es ${min}.`);
  item.cantidad = Math.max(min, v);
  guardarCarrito(); pintarCarrito();
});
$('#btnCarrito').addEventListener('click', () => { pintarCarrito(); abrir('cajonCarrito'); });

/* ═══════════════════════════════════════════════════════════
   5. PUERTA DE SESIÓN + ARCHIVOS DEL CLIENTE
   ═══════════════════════════════════════════════════════════ */
function exigirSesion(accion, mensaje, nuevoCliente = true) {
  if (estado.usuario) { accion(); return true; }
  accionPendiente = accion;
  $$('.capa:not(.oculto)').forEach(cerrar);
  $('#cuPuerta').textContent = mensaje;
  $('#cuPuerta').classList.remove('oculto');
  // Quien llega desde el carrito casi siempre es cliente nuevo:
  // abrimos directo en "crear cuenta" para que no choque contra un login.
  modoRegistro = nuevoCliente;
  aplicarModoCuenta();
  pintarCuenta(); abrir('modalCuenta');
  return false;
}

let folioActivo = null;          // carpeta de Storage del pedido en curso
let archivosPedido = [];         // archivos ya subidos del checkout
let archivosCotiza = [];         // archivos de la cotización a medida
let fallaSubida = false;         // Storage rechazó alguna subida

function folioNuevo() {
  const d = new Date(), p = n => String(n).padStart(2, '0');
  return `EK-${String(d.getFullYear()).slice(2)}${p(d.getMonth() + 1)}${p(d.getDate())}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

const tipoOk = f => f.type === 'application/pdf' || f.type.startsWith('image/');

async function subirDelCliente(archivos, folio, destino, ids) {
  if (!estado.usuario) return;
  const buenos = [...archivos].filter(f => {
    if (!tipoOk(f)) { aviso(`${f.name}: solo aceptamos PDF o imágenes.`, 'mal'); return false; }
    if (f.size > MAX_ARCHIVO) { aviso(`${f.name} pesa más de 25 MB. Mándalo por WhatsApp y lo recibimos ahí.`, 'mal'); return false; }
    return true;
  });
  if (!buenos.length) return;
  const barra = $(ids.barra), prog = $(ids.progreso);
  prog.classList.remove('oculto');
  for (const [n, file] of buenos.entries()) {
    const nombre = `${Date.now()}-${slug(file.name.replace(/\.[^.]+$/, '')) || 'archivo'}.${file.name.split('.').pop() || 'pdf'}`;
    const path = `pedidos/${estado.usuario.uid}/${folio}/${nombre}`;
    try {
      const tarea = uploadBytesResumable(sref(storage, path), file, { contentType: file.type });
      await new Promise((ok, mal) => tarea.on('state_changed',
        s => barra.style.width = `${((n + s.bytesTransferred / s.totalBytes) / buenos.length) * 100}%`, mal, ok));
      destino.push({
        url: await getDownloadURL(tarea.snapshot.ref), path,
        nombre: file.name, tipo: file.type, tamano: file.size
      });
      pintarArchivos(ids.lista, destino);
    } catch (err) {
      console.error(err);
      // La subida ya no bloquea el pedido: se registra y el archivo llega por WhatsApp.
      fallaSubida = true;
      aviso(`No pudimos subir ${file.name}. Tu pedido se puede enviar igual y nos mandas el archivo por WhatsApp.`, 'mal');
      mostrarAvisoArchivos();
    }
  }
  barra.style.width = '100%';
  setTimeout(() => { prog.classList.add('oculto'); barra.style.width = '0'; }, 600);
}

function mostrarAvisoArchivos() {
  const caja = $('#ckArchivoAviso');
  if (!caja) return;
  caja.classList.toggle('oculto', !fallaSubida);
  caja.textContent = 'Uno o más archivos no se pudieron subir. No te preocupes: continúa con el pedido y al terminar te damos un botón para mandárnoslos por WhatsApp.';
}

function pintarArchivos(sel, lista) {
  $(sel).innerHTML = lista.map((a, i) => `
    <li>
      <span class="archivo__icono">${a.tipo === 'application/pdf' ? 'PDF' : 'IMG'}</span>
      <span class="archivo__nombre"><a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.nombre)}</a>
        <small>${kb(a.tamano)}</small></span>
      <button type="button" class="quitar" data-quitar-arch="${i}">Quitar</button>
    </li>`).join('');
  if (sel === '#ckLista') refrescarPie();
}

function quitarArchivo(lista, i, sel) {
  const a = lista[i];
  lista.splice(i, 1);
  pintarArchivos(sel, lista);
  if (a?.path) deleteObject(sref(storage, a.path)).catch(() => {});
}

/* zonas de arrastre del cliente */
function conectarZona(zonaSel, inputSel, botonSel, alSoltar) {
  const zona = $(zonaSel), input = $(inputSel);
  $(botonSel).addEventListener('click', () => input.click());
  input.addEventListener('change', e => { alSoltar([...e.target.files]); e.target.value = ''; });
  ['dragenter', 'dragover'].forEach(ev => zona.addEventListener(ev, e => { e.preventDefault(); zona.classList.add('sobre'); }));
  ['dragleave', 'drop'].forEach(ev => zona.addEventListener(ev, e => { e.preventDefault(); zona.classList.remove('sobre'); }));
  zona.addEventListener('drop', e => alSoltar([...e.dataTransfer.files]));
}

conectarZona('#ckDrop', '#ckArchivos', '#ckElegir',
  f => subirDelCliente(f, folioActivo, archivosPedido, { lista: '#ckLista', progreso: '#ckProgreso', barra: '#ckProgresoBarra' }));
conectarZona('#coDrop', '#coArchivos', '#coElegir',
  f => subirDelCliente(f, folioActivo, archivosCotiza, { lista: '#coLista', progreso: '#coProgreso', barra: '#coProgresoBarra' }));

$('#ckLista').addEventListener('click', e => {
  const b = e.target.closest('[data-quitar-arch]');
  if (b) quitarArchivo(archivosPedido, Number(b.dataset.quitarArch), '#ckLista');
});
$('#coLista').addEventListener('click', e => {
  const b = e.target.closest('[data-quitar-arch]');
  if (b) quitarArchivo(archivosCotiza, Number(b.dataset.quitarArch), '#coLista');
});

document.addEventListener('paste', e => {
  const archivos = [...(e.clipboardData?.files || [])];
  if (!archivos.length) return;
  if (abierto('modalCheckout') && pasoCk === 2) subirDelCliente(archivos, folioActivo, archivosPedido, { lista: '#ckLista', progreso: '#ckProgreso', barra: '#ckProgresoBarra' });
  else if (abierto('modalCotiza')) subirDelCliente(archivos, folioActivo, archivosCotiza, { lista: '#coLista', progreso: '#coProgreso', barra: '#coProgresoBarra' });
  else if (abierto('modalEditor')) subirImagenesProducto(archivos.filter(f => f.type.startsWith('image/')));
});

/* ═══════════════════════════════════════════════════════════
   5b. CHECKOUT EN 3 PASOS
   ═══════════════════════════════════════════════════════════ */
let pasoCk = 1;
let arteElegido = '';   // 'tengo' | 'disenan' | 'despues'

$('#btnIrPagar').addEventListener('click', () => {
  if (!estado.carrito.length) return;
  exigirSesion(abrirCheckout,
    'Antes de terminar necesitas una cuenta. Es rápido: con tu correo y una contraseña guardas el pedido, subes tu diseño y le das seguimiento.');
});

function abrirCheckout() {
  cerrar($('#cajonCarrito'));
  folioActivo = folioNuevo();
  archivosPedido = [];
  fallaSubida = false;
  arteElegido = '';
  pasoCk = 1;

  const f = $('#formCheckout');
  f.reset();
  f.email.value = estado.usuario?.email || auth.currentUser?.email || '';
  pintarArchivos('#ckLista', archivosPedido);
  $$('#ckArte .opcion-arte').forEach(b => { b.classList.remove('elegida'); b.setAttribute('aria-checked', 'false'); });
  $('#ckZonaArchivos').classList.add('oculto');
  $('#ckArchivoAviso').classList.add('oculto');
  $('#ckDireccionCampo').classList.add('oculto');
  limpiarErrores(f);

  $('#ckExito').classList.add('oculto');
  f.classList.remove('oculto');
  $('#ckPie').classList.remove('oculto');

  const hayCotiza = estado.carrito.some(i => i.cotizacion);
  $('#ckSub').textContent = hayCotiza
    ? 'Tu pedido incluye trabajos que se cotizan. Te enviamos el precio antes de imprimir.'
    : 'Tres pasos cortos. Puedes regresar a cambiar cualquier dato.';

  irAPaso(1);
  abrir('modalCheckout');
}

function irAPaso(n) {
  pasoCk = n;
  $$('#formCheckout .paso').forEach(s => s.classList.toggle('oculto', Number(s.dataset.p) !== n));
  $$('#ckPasos li').forEach(li => {
    const p = Number(li.dataset.p);
    li.classList.toggle('activo', p === n);
    li.classList.toggle('listo', p < n);
  });
  if (n === 3) pintarRepaso();
  refrescarPie();
  $('.flujo__cuerpo').scrollTop = 0;
}

function refrescarPie() {
  $('#ckAtras').classList.toggle('oculto', pasoCk === 1);
  $('#ckSiguiente').classList.toggle('oculto', pasoCk === 3);
  $('#ckEnviar').classList.toggle('oculto', pasoCk !== 3);
  $('#ckAviso').textContent = '';

  // El botón NUNCA se deshabilita ni cambia de texto para regañar:
  // si falta algo, lo decimos al presionar y señalamos el campo exacto.
  $('#ckSiguiente').textContent = 'Continuar';
  $('#ckSiguiente').disabled = false;
}

$('#ckAtras').addEventListener('click', () => irAPaso(Math.max(1, pasoCk - 1)));
$('#ckSiguiente').addEventListener('click', () => {
  if (!validarPaso(pasoCk)) return;
  irAPaso(Math.min(3, pasoCk + 1));
});
/* Enter dentro del formulario avanza de paso en vez de recargar la página */
$('#formCheckout').addEventListener('submit', e => {
  e.preventDefault();
  if (pasoCk < 3) $('#ckSiguiente').click();
});
$('#formCheckout').addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') {
    e.preventDefault();
    if (pasoCk < 3) $('#ckSiguiente').click();
  }
});

$('#ckEntrega').addEventListener('change', e => {
  const domicilio = e.target.value === 'domicilio';
  $('#ckDireccionCampo').classList.toggle('oculto', !domicilio);
  if (domicilio) $('#ckDireccionCampo').querySelector('input').focus();
});

$('#ckArte').addEventListener('click', e => {
  const b = e.target.closest('.opcion-arte'); if (!b) return;
  arteElegido = b.dataset.arte;
  $$('#ckArte .opcion-arte').forEach(x => {
    const sel = x === b;
    x.classList.toggle('elegida', sel);
    x.setAttribute('aria-checked', String(sel));
  });
  $('#ckZonaArchivos').classList.toggle('oculto', arteElegido !== 'tengo');
  $('#ckNotasTitulo').textContent = arteElegido === 'disenan'
    ? 'Cuéntanos qué quieres que diseñemos'
    : 'Detalles del trabajo';
  $('#formCheckout').notas.placeholder = arteElegido === 'disenan'
    ? 'Qué dice, qué colores te gustan, si tienes logotipo, para cuándo lo necesitas…'
    : 'Medidas, material, colores, fecha en que lo necesitas…';
  refrescarPie();
});

/* ── Validación clara, campo por campo ─────────────────────── */
function marcarError(campo, mensaje) {
  campo.classList.add('campo--mal');
  const bloque = campo.closest('.campo-bloque');
  const em = bloque?.querySelector('.campo-error');
  if (em) { em.textContent = mensaje; em.classList.remove('oculto'); }
}
function limpiarErrores(raiz) {
  $$('.campo--mal', raiz).forEach(c => c.classList.remove('campo--mal'));
  $$('.campo-error', raiz).forEach(e => { e.textContent = ''; e.classList.add('oculto'); });
}
function avisoPie(texto) {
  $('#ckAviso').textContent = texto;
}

function validarPaso(n) {
  const f = $('#formCheckout');
  limpiarErrores(f);
  avisoPie('');

  if (n === 1) {
    let ok = true, primero = null;
    if (!f.nombre.value.trim()) { marcarError(f.nombre, 'Escribe tu nombre para poder buscarte el pedido.'); primero ||= f.nombre; ok = false; }
    const tel = f.telefono.value.replace(/\D/g, '');
    if (tel.length < 10) { marcarError(f.telefono, 'Necesitamos 10 dígitos para llamarte o mandarte WhatsApp.'); primero ||= f.telefono; ok = false; }
    if (f.entrega.value === 'domicilio' && !f.direccion.value.trim()) {
      marcarError(f.direccion, 'Escribe la dirección donde entregamos.'); primero ||= f.direccion; ok = false;
    }
    if (!ok) { primero.focus(); avisoPie('Revisa los datos marcados.'); }
    return ok;
  }

  if (n === 2) {
    if (!arteElegido) {
      avisoPie('Elige una de las tres opciones para continuar.');
      $('#ckArte').scrollIntoView({ behavior: 'smooth', block: 'center' });
      return false;
    }
    if (arteElegido === 'tengo' && !archivosPedido.length && !fallaSubida) {
      avisoPie('Sube tu archivo, o elige “Te lo mando después” si lo prefieres.');
      $('#ckDrop').scrollIntoView({ behavior: 'smooth', block: 'center' });
      return false;
    }
    if (arteElegido === 'disenan' && f.notas.value.trim().length < 10) {
      marcarError(f.notas, 'Cuéntanos aunque sea en una línea qué quieres que diseñemos.');
      f.notas.focus();
      avisoPie('Falta la descripción del diseño.');
      return false;
    }
    return true;
  }
  return true;
}

function textoArte() {
  return {
    tengo: fallaSubida && !archivosPedido.length
      ? 'Tiene el diseño, pero los archivos no se subieron. Los manda por WhatsApp.'
      : `Subió ${archivosPedido.length} archivo${archivosPedido.length === 1 ? '' : 's'}.`,
    disenan: 'Quiere que EIKON diseñe el arte.',
    despues: 'Manda el diseño después por WhatsApp.'
  }[arteElegido] || '';
}

function pintarRepaso() {
  const f = $('#formCheckout');
  $('#ckResumen').innerHTML = estado.carrito.map(i =>
    `<div><span>${i.cantidad} × ${esc(i.nombre)}${Object.values(i.opciones || {}).length ? ' · ' + esc(Object.values(i.opciones).join(', ')) : ''}</span><span>${i.cotizacion ? 'Por cotizar' : pesos(i.precio * i.cantidad)}</span></div>`
  ).join('') + `<div class="total"><span>Subtotal estimado</span><span>${pesos(totalCarrito())}</span></div>`;

  const entrega = f.entrega.value === 'domicilio'
    ? `Envío a domicilio · ${esc(f.direccion.value.trim())}`
    : 'Recoge en sucursal';

  $('#ckRepaso').innerHTML = `
    <div class="repaso__fila">
      <dl><dt>Contacto</dt>
        <dd>${esc(f.nombre.value.trim())} · ${esc(f.telefono.value.trim())}</dd>
        <dd>${esc(f.email.value)}${f.empresa.value.trim() ? ' · ' + esc(f.empresa.value.trim()) : ''}</dd></dl>
      <button type="button" class="repaso__editar" data-ir="1">Cambiar</button>
    </div>
    <div class="repaso__fila">
      <dl><dt>Entrega</dt><dd>${entrega}</dd></dl>
      <button type="button" class="repaso__editar" data-ir="1">Cambiar</button>
    </div>
    <div class="repaso__fila">
      <dl><dt>Diseño</dt><dd>${esc(textoArte())}</dd>
      ${f.notas.value.trim() ? `<dd>${esc(f.notas.value.trim())}</dd>` : ''}</dl>
      <button type="button" class="repaso__editar" data-ir="2">Cambiar</button>
    </div>`;
}
$('#ckRepaso').addEventListener('click', e => {
  const b = e.target.closest('[data-ir]');
  if (b) irAPaso(Number(b.dataset.ir));
});

/* ── Envío del pedido ───────────────────────────────────────── */
$('#ckEnviar').addEventListener('click', async () => {
  if (!estado.usuario) return aviso('Tu sesión se cerró. Vuelve a entrar para enviar el pedido.', 'mal');
  if (!estado.carrito.length) return aviso('Tu carrito está vacío.', 'mal');

  const btn = $('#ckEnviar');
  btn.disabled = true; btn.textContent = 'Enviando…';
  avisoPie('');

  const f = $('#formCheckout');
  const folio = folioActivo;
  const hayCotiza = estado.carrito.some(i => i.cotizacion);
  const pedido = {
    folio,
    cliente: {
      nombre: f.nombre.value.trim(),
      telefono: f.telefono.value.trim(),
      email: estado.usuario.email,
      empresa: f.empresa.value.trim(),
      entrega: f.entrega.value,
      direccion: f.entrega.value === 'domicilio' ? f.direccion.value.trim() : '',
      notas: [f.notas.value.trim(), textoArte()].filter(Boolean).join('\n')
    },
    items: estado.carrito.map(i => ({
      id: i.id, nombre: i.nombre, cantidad: i.cantidad,
      precio: i.precio, cotizacion: i.cotizacion, opciones: i.opciones || {}
    })),
    archivos: archivosPedido,
    sinArte: arteElegido === 'disenan',
    arte: arteElegido,
    archivosPendientes: arteElegido === 'despues' || (arteElegido === 'tengo' && !archivosPedido.length),
    total: totalCarrito(),
    estado: hayCotiza ? 'cotizacion' : 'nuevo',
    tipo: 'pedido',
    uid: estado.usuario.uid,
    creado: serverTimestamp()
  };

  try {
    await setDoc(doc(db, COL_PED, folio), pedido);

    const resumen = pedido.items.map(i =>
      `• ${i.cantidad} × ${i.nombre}${Object.values(i.opciones).length ? ' (' + Object.values(i.opciones).join(', ') + ')' : ''}`).join('\n');
    $('#ckFolio').textContent = folio;
    $('#ckWhats').href = ligaWhats(
      `Hola EIKON, acabo de hacer el pedido ${folio}.\n\n${resumen}\n\nTotal estimado: ${pesos(pedido.total)}\nNombre: ${pedido.cliente.nombre}` +
      (pedido.archivosPendientes ? '\n\nAquí les mando mi diseño.' : `\nArchivos subidos: ${archivosPedido.length}`));

    f.classList.add('oculto');
    $('#ckPie').classList.add('oculto');
    $('#ckExito').classList.remove('oculto');
    $$('#ckPasos li').forEach(li => { li.classList.remove('activo'); li.classList.add('listo'); });

    estado.carrito = []; guardarCarrito(); pintarCarrito();
    archivosPedido = [];
    aviso('Pedido registrado', 'ok');
  } catch (err) {
    console.error(err);
    avisoPie('No se pudo registrar el pedido. Revisa tu conexión e inténtalo otra vez.');
    aviso('No se pudo registrar el pedido. También puedes mandárnoslo por WhatsApp.', 'mal');
  } finally {
    btn.disabled = false; btn.textContent = 'Enviar pedido';
  }
});

/* ── Cotización a medida ────────────────────────────────────── */
const abrirCotiza = () => {
  folioActivo = folioNuevo();
  archivosCotiza = [];
  pintarArchivos('#coLista', archivosCotiza);
  const f = $('#formCotiza');
  limpiarErrores(f);
  f.email.value = estado.usuario?.email || auth.currentUser?.email || '';
  abrir('modalCotiza');
};
const pedirCotiza = () => exigirSesion(abrirCotiza,
  'Crea tu cuenta para mandarnos la cotización con tus archivos de referencia y darle seguimiento.');
$('#btnCotizarHero').addEventListener('click', pedirCotiza);
$('#btnCotizarAside').addEventListener('click', pedirCotiza);

$('#formCotiza').addEventListener('submit', async e => {
  e.preventDefault();
  if (!estado.usuario) return;
  const f = e.target;
  limpiarErrores(f);

  let ok = true, primero = null;
  if (!f.nombre.value.trim()) { marcarError(f.nombre, 'Escribe tu nombre.'); primero ||= f.nombre; ok = false; }
  if (f.telefono.value.replace(/\D/g, '').length < 10) { marcarError(f.telefono, 'Necesitamos 10 dígitos.'); primero ||= f.telefono; ok = false; }
  if (f.notas.value.trim().length < 10) { marcarError(f.notas, 'Cuéntanos un poco más de lo que necesitas.'); primero ||= f.notas; ok = false; }
  if (!ok) return primero.focus();

  const btn = $('#coEnviar'); btn.disabled = true; btn.textContent = 'Enviando…';
  const folio = folioActivo;
  try {
    await setDoc(doc(db, COL_PED, folio), {
      folio,
      cliente: {
        nombre: f.nombre.value.trim(), telefono: f.telefono.value.trim(),
        email: estado.usuario.email, empresa: '', entrega: 'sucursal', direccion: '',
        notas: `Cantidad aprox.: ${f.cantidad.value.trim() || 'sin especificar'}\n${f.notas.value.trim()}`
      },
      items: [{ id: 'medida', nombre: 'Trabajo a medida', cantidad: 1, precio: 0, cotizacion: true, opciones: {} }],
      archivos: archivosCotiza, sinArte: false, arte: 'cotizacion',
      total: 0, estado: 'cotizacion', tipo: 'cotizacion',
      uid: estado.usuario.uid, creado: serverTimestamp()
    });
    cerrar($('#modalCotiza')); f.reset(); archivosCotiza = [];
    aviso(`Solicitud enviada. Tu folio es ${folio}.`, 'ok');
  } catch (err) { console.error(err); aviso('No se pudo enviar la solicitud. Inténtalo de nuevo o escríbenos por WhatsApp.', 'mal'); }
  finally { btn.disabled = false; btn.textContent = 'Enviar solicitud'; }
});

/* ═══════════════════════════════════════════════════════════
   6. CUENTA
   ═══════════════════════════════════════════════════════════ */
let modoRegistro = false;

function aplicarModoCuenta() {
  $('#cuTitulo').textContent = modoRegistro ? 'Crear cuenta' : 'Ingresar';
  $('#btnCambiarModo').textContent = modoRegistro ? 'Ya tengo cuenta' : 'Crear una cuenta nueva';
  $('#cuEnviar').textContent = modoRegistro ? 'Crear cuenta y continuar' : 'Entrar';
  $('#cuPista').textContent = modoRegistro
    ? 'Mínimo 6 caracteres. Anótala, la necesitas para ver tus pedidos.'
    : 'Si no la recuerdas, usa “Olvidé mi contraseña”.';
  $('#formCuenta').password.autocomplete = modoRegistro ? 'new-password' : 'current-password';
  $('#cuError').classList.add('oculto');
  $('#btnOlvide').classList.toggle('oculto', modoRegistro);
}
$('#btnCambiarModo').addEventListener('click', () => { modoRegistro = !modoRegistro; aplicarModoCuenta(); });

$('#btnVerClave').addEventListener('click', () => {
  const inp = $('#formCuenta').password;
  const ver = inp.type === 'password';
  inp.type = ver ? 'text' : 'password';
  $('#btnVerClave').textContent = ver ? 'Ocultar' : 'Ver';
  inp.focus();
});

$('#btnCuenta').addEventListener('click', () => {
  $('#cuPuerta').classList.add('oculto');
  if (!estado.usuario) { modoRegistro = false; aplicarModoCuenta(); }
  pintarCuenta(); abrir('modalCuenta');
});

function errorCuenta(html) {
  const err = $('#cuError');
  err.innerHTML = html;
  err.classList.remove('oculto');
}

$('#formCuenta').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target;
  const correo = f.email.value.trim(), clave = f.password.value;
  const btn = $('#cuEnviar');
  $('#cuError').classList.add('oculto');
  btn.disabled = true; btn.textContent = modoRegistro ? 'Creando…' : 'Entrando…';
  try {
    if (modoRegistro) await createUserWithEmailAndPassword(auth, correo, clave);
    else await signInWithEmailAndPassword(auth, correo, clave);
    f.reset();
    cerrar($('#modalCuenta'));
    $('#cuPuerta').classList.add('oculto');
    if (accionPendiente) { const a = accionPendiente; accionPendiente = null; setTimeout(a, 180); }
  } catch (ex) {
    // Los dos casos que más atoran a la gente se resuelven solos:
    if (ex.code === 'auth/email-already-in-use') {
      modoRegistro = false; aplicarModoCuenta();
      f.email.value = correo; f.password.value = '';
      errorCuenta('Ese correo ya tiene cuenta. Escribe tu contraseña para entrar, o usa “Olvidé mi contraseña”.');
      f.password.focus();
    } else if (ex.code === 'auth/invalid-credential' || ex.code === 'auth/user-not-found' || ex.code === 'auth/wrong-password') {
      errorCuenta('El correo o la contraseña no coinciden. <button type="button" class="enlace-verde" id="cuCrear">¿Es tu primera vez? Crea tu cuenta</button>');
      $('#cuCrear')?.addEventListener('click', () => {
        modoRegistro = true; aplicarModoCuenta();
        f.password.value = ''; f.password.focus();
      });
    } else {
      errorCuenta({
        'auth/invalid-email': 'Ese correo no tiene un formato válido.',
        'auth/weak-password': 'La contraseña necesita al menos 6 caracteres.',
        'auth/too-many-requests': 'Demasiados intentos. Espera un momento y vuelve a probar.',
        'auth/network-request-failed': 'No hay conexión. Revisa tu internet e inténtalo otra vez.',
        'auth/operation-not-allowed': 'El acceso por correo no está activo. Escríbenos por WhatsApp y tomamos tu pedido.'
      }[ex.code] || 'No pudimos completar el acceso. Inténtalo de nuevo.');
    }
  } finally {
    btn.disabled = false;
    btn.textContent = modoRegistro ? 'Crear cuenta y continuar' : 'Entrar';
  }
});

$('#btnOlvide').addEventListener('click', async () => {
  const correo = $('#formCuenta').email.value.trim();
  if (!correo) { aviso('Escribe tu correo y vuelve a presionar.', 'mal'); return $('#formCuenta').email.focus(); }
  try {
    await sendPasswordResetEmail(auth, correo);
    aviso('Te mandamos un correo para restablecer la contraseña. Revisa también spam.', 'ok');
  } catch { aviso('No pudimos enviar el correo de recuperación.', 'mal'); }
});

$('#btnSalir').addEventListener('click', () => signOut(auth));
$('#btnSalirAdmin').addEventListener('click', () => { signOut(auth); mostrarTienda(); });

function pintarCuenta() {
  const dentro = !!estado.usuario;
  $('#formCuenta').classList.toggle('oculto', dentro);
  $('#cuSesion').classList.toggle('oculto', !dentro);
  $('#cuSub').classList.toggle('oculto', dentro);
  $('#cuTitulo').textContent = dentro ? 'Tu cuenta' : (modoRegistro ? 'Crear cuenta' : 'Ingresar');
  if (dentro) { $('#cuCorreo').textContent = estado.usuario.email; cargarMisPedidos(); }
}

async function cargarMisPedidos() {
  const caja = $('#cuPedidos');
  caja.innerHTML = '<p class="sub">Buscando tus pedidos…</p>';
  try {
    const snap = await getDocs(query(collection(db, COL_PED), where('uid', '==', estado.usuario.uid)));
    const lista = snap.docs.map(d => d.data()).sort((a, b) => (b.creado?.seconds || 0) - (a.creado?.seconds || 0));
    caja.innerHTML = lista.length ? lista.map(p => `
      <article>
        <strong>${esc(p.folio)}</strong> · ${etiquetaEstado(p.estado)}
        <div class="sub">${p.items.length} ${p.items.length === 1 ? 'partida' : 'partidas'} · ${p.total ? pesos(p.total) : 'por cotizar'}
        ${p.archivos?.length ? ` · ${p.archivos.length} archivo${p.archivos.length > 1 ? 's' : ''}` : ''}</div>
      </article>`).join('')
      : '<p class="sub">Todavía no tienes pedidos con esta cuenta. Cuando hagas uno, aparece aquí con su folio.</p>';
  } catch { caja.innerHTML = '<p class="sub">No pudimos cargar tus pedidos en este momento.</p>'; }
}

onAuthStateChanged(auth, user => {
  estado.usuario = user;
  estado.esAdmin = !!user && user.uid === ADMIN_UID;
  $('#btnCuenta').querySelector('span').textContent = user ? 'Mi cuenta' : 'Ingresar';
  $('#btnAdmin').classList.toggle('oculto', !estado.esAdmin);
  $('#adminCorreo').textContent = user?.email || '';
  if (estado.esAdmin) { escucharPedidos(); if (location.hash === LLAVE_PANEL) mostrarAdmin(); }
  else { desuscribirPedidos?.(); desuscribirPedidos = null; estado.pedidos = []; mostrarTienda(); }
  pintarCuenta(); pintarCarrito(); pintarCatalogo(); pintarNavCats();
});

/* ═══════════════════════════════════════════════════════════
   7. PANEL: navegación y acceso discreto
   ═══════════════════════════════════════════════════════════ */
function mostrarTienda() {
  $('#vistaAdmin').classList.add('oculto');
  $('#vistaTienda').classList.remove('oculto');
  $('.cabecera').classList.remove('oculto');
  $('#fabWhats').classList.remove('oculto');
}
function mostrarAdmin() {
  if (!estado.esAdmin) return;
  $('#vistaTienda').classList.add('oculto');
  $('.cabecera').classList.add('oculto');
  $('#fabWhats').classList.add('oculto');
  $('#vistaAdmin').classList.remove('oculto');
  window.scrollTo(0, 0);
  pintarTablaProductos(); pintarListaCatsAdmin(); pintarPedidos(); pintarSelectsCategorias();
}
$('#btnAdmin').addEventListener('click', mostrarAdmin);
$('#btnVerTienda').addEventListener('click', mostrarTienda);

/* Tres puertas discretas al panel. Ninguna da acceso por sí sola:
   solo abren la ventana de acceso normal. */
function puertaPanel() {
  if (estado.esAdmin) return mostrarAdmin();
  if (estado.usuario) return; // sesión de cliente: no hay nada que mostrar
  $('#cuPuerta').classList.add('oculto');
  modoRegistro = false; aplicarModoCuenta();
  pintarCuenta(); abrir('modalCuenta');
}
if (location.hash === LLAVE_PANEL) setTimeout(puertaPanel, 400);
window.addEventListener('hashchange', () => { if (location.hash === LLAVE_PANEL) puertaPanel(); });
document.addEventListener('keydown', e => {
  if (e.ctrlKey && e.altKey && (e.key === 'e' || e.key === 'E')) { e.preventDefault(); puertaPanel(); }
});
let golpes = 0, relojGolpes = null;
$('#anio').addEventListener('click', () => {
  golpes++;
  clearTimeout(relojGolpes);
  relojGolpes = setTimeout(() => golpes = 0, 900);
  if (golpes >= 5) { golpes = 0; puertaPanel(); }
});

$('#adminTabs').addEventListener('click', e => {
  const t = e.target.closest('.tab'); if (!t) return;
  $$('#adminTabs .tab').forEach(x => x.classList.toggle('activo', x === t));
  $$('.admin__cuerpo .panel').forEach(p => p.classList.add('oculto'));
  $('#panel-' + t.dataset.tab).classList.remove('oculto');
});

function pintarSelectsCategorias() {
  const ops = estado.categorias.map(c => `<option value="${c.id}">${esc(c.nombre)}</option>`).join('');
  const edSel = $('#edCategoria');
  if (edSel) { const v = edSel.value; edSel.innerHTML = ops || '<option value="">Crea una categoría</option>'; if (v) edSel.value = v; }
  const f1 = $('#adminFiltroCat'); if (f1) { const v = f1.value; f1.innerHTML = '<option value="">Todas las categorías</option>' + ops; f1.value = v; }
  const f2 = $('#loteCategoria'); if (f2) f2.innerHTML = '<option value="">Mover a categoría…</option>' + ops;
}

/* ═══════════════════════════════════════════════════════════
   8. PANEL: productos (tabla dinámica)
   ═══════════════════════════════════════════════════════════ */
['#adminBuscaProd', '#adminFiltroCat', '#adminFiltroEstado'].forEach(s =>
  $(s).addEventListener('input', pintarTablaProductos));

function productosAdmin() {
  const t = ($('#adminBuscaProd').value || '').toLowerCase();
  const cat = $('#adminFiltroCat').value;
  const est = $('#adminFiltroEstado').value;
  return estado.productos
    .filter(p => !t || (p.nombre + ' ' + (p.sku || '') + ' ' + nombreCat(p.categoria)).toLowerCase().includes(t))
    .filter(p => !cat || p.categoria === cat)
    .filter(p => ({
      '': () => true,
      visible: () => p.activo !== false,
      oculto: () => p.activo === false,
      destacado: () => !!p.destacado,
      cotizacion: () => !!p.cotizacion || p.precio == null,
      sinfoto: () => !p.imagenes?.length
    }[est])())
    .sort((a, b) => (a.orden ?? 100) - (b.orden ?? 100) || String(a.nombre).localeCompare(b.nombre));
}

function pintarTablaProductos() {
  const tb = $('#adminTablaProd'); if (!tb) return;
  const lista = productosAdmin();
  $('#adminConteoProd').textContent =
    `${estado.productos.length} en total · ${estado.productos.filter(p => p.activo === false).length} ocultos · ${estado.productos.filter(p => !p.imagenes?.length).length} sin foto`;

  tb.innerHTML = lista.length ? lista.map((p, i) => `
    <tr data-id="${p.id}" class="${estado.seleccion.has(p.id) ? 'fila--sel' : ''}">
      <td class="col-check"><input type="checkbox" data-sel="${p.id}" ${estado.seleccion.has(p.id) ? 'checked' : ''} aria-label="Seleccionar ${esc(p.nombre)}"></td>
      <td><div class="celda-prod">
        ${portada(p) ? `<img src="${esc(portada(p))}" alt="">` : '<div class="celda-prod__sinfoto">sin foto</div>'}
        <div><strong>${esc(p.nombre)}</strong><small>${esc(p.sku || p.id)}</small></div></div></td>
      <td><button class="celda-edit" data-edit-cat="${p.id}">${esc(nombreCat(p.categoria))}</button></td>
      <td><button class="celda-edit" data-edit-precio="${p.id}">${p.cotizacion || p.precio == null
        ? '<span class="chip chip--ambar">Cotización</span>'
        : `<strong>${p.precioDesde ? 'desde ' : ''}${pesos(p.precio)}</strong><small>${UNIDADES[p.unidad] || ''}</small>`}</button></td>
      <td class="col-orden">
        <div class="mover">
          <button type="button" data-subir="${p.id}" ${i === 0 ? 'disabled' : ''} aria-label="Subir">↑</button>
          <span>${p.orden ?? 100}</span>
          <button type="button" data-bajar="${p.id}" ${i === lista.length - 1 ? 'disabled' : ''} aria-label="Bajar">↓</button>
        </div>
      </td>
      <td>
        <label class="interruptor" title="Visible en la tienda">
          <input type="checkbox" data-activo="${p.id}" ${p.activo !== false ? 'checked' : ''}><span></span>
        </label>
        <button class="estrella ${p.destacado ? 'estrella--on' : ''}" data-destacado="${p.id}" title="Destacar">★</button>
      </td>
      <td><div class="acciones-fila">
        <button data-editar="${p.id}" type="button">Editar</button>
        <button data-duplicar="${p.id}" type="button">Duplicar</button>
        <button class="borrar" data-borrar="${p.id}" type="button">Borrar</button>
      </div></td>
    </tr>`).join('')
    : `<tr><td colspan="7" class="celda-vacia">No hay productos que coincidan con el filtro. Crea uno con “Nuevo producto”.</td></tr>`;

  actualizarLote();
}

/* ── Acciones de la tabla ───────────────────────────────────── */
$('#adminTablaProd').addEventListener('click', async e => {
  const b = e.target.closest('button'); if (!b) return;
  const d = b.dataset;
  if (d.editar) return abrirEditor(estado.productos.find(p => p.id === d.editar));
  if (d.duplicar) return duplicarProducto(estado.productos.find(p => p.id === d.duplicar));
  if (d.borrar) {
    const p = estado.productos.find(x => x.id === d.borrar);
    if (confirm(`¿Eliminar “${p.nombre}”? También se borran sus imágenes.`)) await borrarProducto(p);
    return;
  }
  if (d.destacado) {
    const p = estado.productos.find(x => x.id === d.destacado);
    return guardarCampo(p.id, { destacado: !p.destacado });
  }
  if (d.subir || d.bajar) return moverProducto(d.subir || d.bajar, d.subir ? -1 : 1);
  if (d.editPrecio) return editarPrecioEnLinea(b, d.editPrecio);
  if (d.editCat) return editarCategoriaEnLinea(b, d.editCat);
});

$('#adminTablaProd').addEventListener('change', async e => {
  const t = e.target;
  if (t.dataset.activo) return guardarCampo(t.dataset.activo, { activo: t.checked });
  if (t.dataset.sel) {
    t.checked ? estado.seleccion.add(t.dataset.sel) : estado.seleccion.delete(t.dataset.sel);
    t.closest('tr').classList.toggle('fila--sel', t.checked);
    actualizarLote();
  }
});

async function guardarCampo(id, datos) {
  try { await updateDoc(doc(db, COL_PROD, id), { ...datos, actualizado: serverTimestamp() }); }
  catch (err) { console.error(err); aviso('No se pudo guardar el cambio', 'mal'); }
}

function editarPrecioEnLinea(boton, id) {
  const p = estado.productos.find(x => x.id === id);
  const td = boton.parentElement;
  td.innerHTML = `<div class="editor-linea">
      <input class="campo" type="number" min="0" step="0.01" value="${p.precio ?? ''}" placeholder="Cotización">
      <select class="campo">${Object.entries(UNIDADES).map(([k, v]) => `<option value="${k}" ${p.unidad === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
      <label class="casilla-sola"><input type="checkbox" ${p.precioDesde ? 'checked' : ''}> desde</label>
    </div>`;
  const [inp, sel] = [td.querySelector('input[type=number]'), td.querySelector('select')];
  const chk = td.querySelector('input[type=checkbox]');
  inp.focus(); inp.select();
  const guardar = async () => {
    const v = inp.value === '' ? null : Number(inp.value);
    await guardarCampo(id, { precio: v, unidad: sel.value, precioDesde: chk.checked, cotizacion: v === null });
    pintarTablaProductos();
  };
  inp.addEventListener('keydown', ev => { if (ev.key === 'Enter') guardar(); if (ev.key === 'Escape') pintarTablaProductos(); });
  td.addEventListener('focusout', () => setTimeout(() => { if (!td.contains(document.activeElement)) guardar(); }, 80));
}

function editarCategoriaEnLinea(boton, id) {
  const p = estado.productos.find(x => x.id === id);
  const td = boton.parentElement;
  td.innerHTML = `<select class="campo">${estado.categorias.map(c => `<option value="${c.id}" ${p.categoria === c.id ? 'selected' : ''}>${esc(c.nombre)}</option>`).join('')}</select>`;
  const sel = td.querySelector('select');
  sel.focus();
  sel.addEventListener('change', async () => { await guardarCampo(id, { categoria: sel.value }); pintarTablaProductos(); });
  sel.addEventListener('blur', () => pintarTablaProductos());
}

async function moverProducto(id, dir) {
  const lista = productosAdmin();
  const i = lista.findIndex(p => p.id === id), j = i + dir;
  if (j < 0 || j >= lista.length) return;
  const a = lista[i], b = lista[j];
  const lote = writeBatch(db);
  lote.update(doc(db, COL_PROD, a.id), { orden: b.orden ?? (j + 1) * 10 });
  lote.update(doc(db, COL_PROD, b.id), { orden: a.orden ?? (i + 1) * 10 });
  try { await lote.commit(); } catch (err) { console.error(err); aviso('No se pudo reordenar', 'mal'); }
}

async function borrarProducto(p) {
  try {
    for (const im of p.imagenes || []) if (im.path) await deleteObject(sref(storage, im.path)).catch(() => {});
    await deleteDoc(doc(db, COL_PROD, p.id));
    estado.seleccion.delete(p.id);
    aviso('Producto eliminado', 'ok');
  } catch (err) { console.error(err); aviso('No se pudo eliminar el producto', 'mal'); }
}

async function duplicarProducto(p) {
  const copia = { ...p, nombre: p.nombre + ' (copia)', activo: false, destacado: false, actualizado: serverTimestamp() };
  delete copia.id;
  copia.sku = (p.sku || '') ? p.sku + '-2' : '';
  try {
    await setDoc(doc(db, COL_PROD, slug(copia.nombre) + '-' + Math.random().toString(36).slice(2, 5)), copia);
    aviso('Producto duplicado. Quedó oculto hasta que lo revises.', 'ok');
  } catch (err) { console.error(err); aviso('No se pudo duplicar', 'mal'); }
}

/* ── Acciones en lote ───────────────────────────────────────── */
function actualizarLote() {
  const n = estado.seleccion.size;
  $('#loteBarra').classList.toggle('oculto', !n);
  $('#loteConteo').textContent = `${n} ${n === 1 ? 'seleccionado' : 'seleccionados'}`;
  const visibles = productosAdmin();
  $('#loteTodos').checked = visibles.length > 0 && visibles.every(p => estado.seleccion.has(p.id));
}
$('#loteTodos').addEventListener('change', e => {
  const visibles = productosAdmin();
  visibles.forEach(p => e.target.checked ? estado.seleccion.add(p.id) : estado.seleccion.delete(p.id));
  pintarTablaProductos();
});
$('#loteCancelar').addEventListener('click', () => { estado.seleccion.clear(); pintarTablaProductos(); });
$('#loteCategoria').addEventListener('change', async e => {
  if (!e.target.value) return;
  await aplicarLote({ categoria: e.target.value });
  e.target.value = '';
});
$('#loteBarra').addEventListener('click', async e => {
  const acc = e.target.closest('[data-lote]')?.dataset.lote; if (!acc) return;
  if (acc === 'borrar') {
    if (!confirm(`¿Eliminar ${estado.seleccion.size} productos y sus imágenes?`)) return;
    for (const id of [...estado.seleccion]) {
      const p = estado.productos.find(x => x.id === id); if (p) await borrarProducto(p);
    }
    estado.seleccion.clear(); pintarTablaProductos();
    return;
  }
  await aplicarLote({
    mostrar: { activo: true }, ocultar: { activo: false },
    destacar: { destacado: true }, 'quitar-destacado': { destacado: false }
  }[acc]);
});
async function aplicarLote(datos) {
  const lote = writeBatch(db);
  estado.seleccion.forEach(id => lote.update(doc(db, COL_PROD, id), datos));
  try { await lote.commit(); aviso(`${estado.seleccion.size} productos actualizados`, 'ok'); }
  catch (err) { console.error(err); aviso('No se pudieron aplicar los cambios', 'mal'); }
}

/* ═══════════════════════════════════════════════════════════
   9. PANEL: editor de producto
   ═══════════════════════════════════════════════════════════ */
let edId = null, edImagenes = [], edOpciones = [];

$('#btnNuevoProd').addEventListener('click', () => abrirEditor(null));

function abrirEditor(p) {
  const f = $('#formProducto');
  f.reset();
  edId = p?.id || doc(collection(db, COL_PROD)).id;
  edImagenes = p?.imagenes ? p.imagenes.map(i => ({ ...i })) : [];
  edOpciones = p?.opciones ? p.opciones.map(o => ({ nombre: o.nombre, valores: [...o.valores] })) : [];
  $('#edTitulo').textContent = p ? 'Editar producto' : 'Nuevo producto';
  $('#edBorrar').classList.toggle('oculto', !p);
  $('#edDuplicar').classList.toggle('oculto', !p);
  $('#edCatNueva').classList.add('oculto');
  pintarSelectsCategorias();

  if (p) {
    f.nombre.value = p.nombre || ''; f.categoria.value = p.categoria || '';
    f.sku.value = p.sku || ''; f.descripcionCorta.value = p.descripcionCorta || '';
    f.descripcion.value = p.descripcion || ''; f.precio.value = p.precio ?? '';
    f.unidad.value = p.unidad || 'pieza'; f.minimo.value = p.minimo || 1;
    f.orden.value = p.orden ?? 100;
    f.precioDesde.checked = !!p.precioDesde; f.cotizacion.checked = !!p.cotizacion;
    f.destacado.checked = !!p.destacado; f.activo.checked = p.activo !== false;
  } else {
    f.activo.checked = true; f.minimo.value = 1;
    f.orden.value = (Math.max(0, ...estado.productos.map(x => x.orden ?? 0)) + 10) || 10;
    if (estado.filtro.cat) f.categoria.value = estado.filtro.cat;
  }
  f.precio.disabled = f.cotizacion.checked;
  pintarOpcionesEditor(); pintarGaleria(); pintarPrevia();
  abrir('modalEditor');
}

/* nombre → SKU y previsualización en vivo */
$('#formProducto').addEventListener('input', e => {
  const f = $('#formProducto');
  if (e.target.name === 'nombre' && !f.sku.value.trim()) {
    f.sku.placeholder = 'EK-' + slug(f.nombre.value).slice(0, 10).toUpperCase();
  }
  if (e.target.name === 'cotizacion') f.precio.disabled = f.cotizacion.checked;
  pintarPrevia();
});
$('#formProducto').addEventListener('change', e => {
  if (e.target.name === 'cotizacion') $('#formProducto').precio.disabled = e.target.checked;
  pintarPrevia();
});

function datosDelFormulario() {
  const f = $('#formProducto');
  return {
    nombre: f.nombre.value.trim(),
    categoria: f.categoria.value,
    sku: f.sku.value.trim() || f.sku.placeholder || '',
    descripcionCorta: f.descripcionCorta.value.trim(),
    descripcion: f.descripcion.value.trim(),
    precio: f.cotizacion.checked || f.precio.value === '' ? null : Number(f.precio.value),
    unidad: f.unidad.value,
    minimo: Number(f.minimo.value) || 1,
    orden: Number(f.orden.value) || 100,
    precioDesde: f.precioDesde.checked,
    cotizacion: f.cotizacion.checked,
    destacado: f.destacado.checked,
    activo: f.activo.checked,
    opciones: edOpciones.filter(o => o.nombre.trim() && o.valores.length),
    imagenes: edImagenes
  };
}
function pintarPrevia() {
  const d = datosDelFormulario();
  $('#edVistaPrevia').innerHTML = tarjetaHTML({ ...d, id: 'previa' });
}

/* ── Categoría nueva desde el editor ────────────────────────── */
$('#edNuevaCat').addEventListener('click', () => {
  $('#edCatNueva').classList.toggle('oculto');
  if (!$('#edCatNueva').classList.contains('oculto')) $('#edCatNombre').focus();
});
$('#edCatNombre').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('#edCatCrear').click(); } });
$('#edCatCrear').addEventListener('click', async () => {
  const nombre = $('#edCatNombre').value.trim();
  if (!nombre) return;
  const id = await crearCategoria(nombre);
  if (id) {
    $('#edCatNombre').value = '';
    $('#edCatNueva').classList.add('oculto');
    setTimeout(() => { $('#edCategoria').value = id; pintarPrevia(); }, 250);
  }
});

async function crearCategoria(nombre) {
  const id = slug(nombre);
  if (!id) return null;
  try {
    await setDoc(doc(db, COL_CAT, id), {
      nombre, descripcion: '', activa: true,
      orden: (Math.max(0, ...estado.categorias.map(c => c.orden ?? 0)) + 10) || 10
    }, { merge: true });
    aviso(`Categoría “${nombre}” creada`, 'ok');
    return id;
  } catch (err) { console.error(err); aviso('No se pudo crear la categoría', 'mal'); return null; }
}

/* ── Constructor de opciones ────────────────────────────────── */
function pintarOpcionesEditor() {
  $('#edOpciones').innerHTML = edOpciones.map((o, i) => `
    <div class="opcion-fila" data-i="${i}">
      <input class="campo" data-campo="nombre" value="${esc(o.nombre)}" placeholder="Acabado">
      <input class="campo" data-campo="valores" value="${esc(o.valores.join(', '))}" placeholder="Mate, Brillante">
      <button type="button" class="quitar-opcion" aria-label="Quitar opción">×</button>
    </div>`).join('') || '<p class="pista">Sin opciones. El cliente solo elegirá la cantidad.</p>';
}
$('#edAddOpcion').addEventListener('click', () => {
  edOpciones.push({ nombre: '', valores: [] });
  pintarOpcionesEditor();
  $('#edOpciones').querySelector('.opcion-fila:last-child input')?.focus();
});
$('#edOpciones').addEventListener('input', e => {
  const fila = e.target.closest('.opcion-fila'); if (!fila) return;
  const o = edOpciones[Number(fila.dataset.i)];
  if (e.target.dataset.campo === 'nombre') o.nombre = e.target.value;
  else o.valores = e.target.value.split(',').map(v => v.trim()).filter(Boolean);
  pintarPrevia();
});
$('#edOpciones').addEventListener('click', e => {
  if (!e.target.closest('.quitar-opcion')) return;
  edOpciones.splice(Number(e.target.closest('.opcion-fila').dataset.i), 1);
  pintarOpcionesEditor(); pintarPrevia();
});

/* ── Galería con reordenamiento ─────────────────────────────── */
function pintarGaleria() {
  $('#edGaleria').innerHTML = edImagenes.map((im, i) => `
    <figure draggable="true" data-i="${i}" class="${i === 0 ? 'es-portada' : ''}">
      <img src="${esc(im.url)}" alt="">
      <div class="galeria__acciones">
        ${i > 0 ? `<button type="button" data-portada="${i}" title="Usar como portada">★</button>` : ''}
        <button type="button" data-quitar-img="${i}" title="Quitar">×</button>
      </div>
    </figure>`).join('') || '<p class="pista">Todavía no hay fotografías.</p>';
  pintarPrevia();
}
$('#edGaleria').addEventListener('click', e => {
  const port = e.target.closest('[data-portada]');
  if (port) {
    const i = Number(port.dataset.portada);
    edImagenes.unshift(edImagenes.splice(i, 1)[0]);
    return pintarGaleria();
  }
  const quit = e.target.closest('[data-quitar-img]');
  if (quit) {
    const im = edImagenes.splice(Number(quit.dataset.quitarImg), 1)[0];
    pintarGaleria();
    if (im?.path) deleteObject(sref(storage, im.path)).catch(() => {});
  }
});
let arrastrando = null;
$('#edGaleria').addEventListener('dragstart', e => {
  const f = e.target.closest('figure'); if (!f) return;
  arrastrando = Number(f.dataset.i); f.classList.add('arrastrando');
});
$('#edGaleria').addEventListener('dragend', e => e.target.closest('figure')?.classList.remove('arrastrando'));
$('#edGaleria').addEventListener('dragover', e => e.preventDefault());
$('#edGaleria').addEventListener('drop', e => {
  e.preventDefault();
  const destino = e.target.closest('figure'); if (!destino || arrastrando === null) return;
  const j = Number(destino.dataset.i);
  edImagenes.splice(j, 0, edImagenes.splice(arrastrando, 1)[0]);
  arrastrando = null; pintarGaleria();
});

/* ── Subida de imágenes del producto ────────────────────────── */
$('#edElegir').addEventListener('click', () => $('#edArchivos').click());
$('#edArchivos').addEventListener('change', e => { subirImagenesProducto([...e.target.files]); e.target.value = ''; });
['dragenter', 'dragover'].forEach(ev => $('#edDrop').addEventListener(ev, e => { e.preventDefault(); $('#edDrop').classList.add('sobre'); }));
['dragleave', 'drop'].forEach(ev => $('#edDrop').addEventListener(ev, e => { e.preventDefault(); $('#edDrop').classList.remove('sobre'); }));
$('#edDrop').addEventListener('drop', e => subirImagenesProducto([...e.dataTransfer.files].filter(f => f.type.startsWith('image/'))));

async function subirImagenesProducto(archivos) {
  if (!archivos.length || !estado.esAdmin) return;
  const barra = $('#edProgresoBarra');
  $('#edProgreso').classList.remove('oculto');
  for (const [n, file] of archivos.entries()) {
    if (file.size > MAX_ARCHIVO) { aviso(`${file.name} pesa más de 25 MB.`, 'mal'); continue; }
    const path = `productos/${edId}/${Date.now()}-${slug(file.name.replace(/\.[^.]+$/, '')) || 'foto'}.${file.name.split('.').pop() || 'jpg'}`;
    try {
      const tarea = uploadBytesResumable(sref(storage, path), file, { contentType: file.type });
      await new Promise((ok, mal) => tarea.on('state_changed',
        s => barra.style.width = `${((n + s.bytesTransferred / s.totalBytes) / archivos.length) * 100}%`, mal, ok));
      edImagenes.push({ url: await getDownloadURL(tarea.snapshot.ref), path });
      pintarGaleria();
    } catch (err) { console.error(err); aviso(`No se pudo subir ${file.name}.`, 'mal'); }
  }
  barra.style.width = '100%';
  setTimeout(() => { $('#edProgreso').classList.add('oculto'); barra.style.width = '0'; }, 600);
}

/* ── Guardar / borrar / duplicar desde el editor ────────────── */
$('#formProducto').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = $('#edGuardar');
  const datos = datosDelFormulario();
  if (!datos.nombre) return aviso('Ponle nombre al producto antes de guardar.', 'mal');
  if (!datos.categoria) return aviso('Elige o crea una categoría antes de guardar.', 'mal');
  btn.disabled = true; btn.textContent = 'Guardando…';
  try {
    await setDoc(doc(db, COL_PROD, edId), { ...datos, actualizado: serverTimestamp() }, { merge: true });
    $('#edEstadoGuardado').textContent = 'Guardado. Ya se ve así en la tienda.';
    aviso('Producto guardado', 'ok');
    cerrar($('#modalEditor'));
  } catch (err) {
    console.error(err);
    aviso('No se pudo guardar. Verifica que tu sesión sea la de administrador.', 'mal');
  } finally { btn.disabled = false; btn.textContent = 'Guardar producto'; }
});
$('#edBorrar').addEventListener('click', async () => {
  const p = estado.productos.find(x => x.id === edId);
  if (!p || !confirm(`¿Eliminar “${p.nombre}”?`)) return;
  await borrarProducto(p); cerrar($('#modalEditor'));
});
$('#edDuplicar').addEventListener('click', async () => {
  const p = estado.productos.find(x => x.id === edId);
  if (p) { await duplicarProducto(p); cerrar($('#modalEditor')); }
});

/* ═══════════════════════════════════════════════════════════
   10. PANEL: categorías
   ═══════════════════════════════════════════════════════════ */
function pintarListaCatsAdmin() {
  const ul = $('#adminListaCats'); if (!ul) return;
  const usados = id => estado.productos.filter(p => p.categoria === id).length;
  $('#adminConteoCats').textContent = `${estado.categorias.length} categorías · ${estado.categorias.filter(c => c.activa === false).length} ocultas`;
  ul.innerHTML = estado.categorias.length ? estado.categorias.map(c => `
    <li draggable="true" data-id="${c.id}">
      <span class="agarre" title="Arrastra para reordenar">⠿</span>
      <input class="campo campo--linea" data-nombre="${c.id}" value="${esc(c.nombre)}">
      <span class="chip chip--gris">${usados(c.id)} productos</span>
      <label class="interruptor" title="Visible en la tienda">
        <input type="checkbox" data-cat-activa="${c.id}" ${c.activa !== false ? 'checked' : ''}><span></span>
      </label>
      <div class="acciones-fila">
        <button type="button" data-cat-editar="${c.id}">Detalles</button>
        <button type="button" class="borrar" data-cat-borrar="${c.id}">Borrar</button>
      </div>
    </li>`).join('')
    : '<li class="celda-vacia">Todavía no hay categorías. Crea la primera arriba.</li>';
}

$('#formCatRapida').addEventListener('submit', async e => {
  e.preventDefault();
  const inp = e.target.nombre;
  if (await crearCategoria(inp.value.trim())) inp.value = '';
  inp.focus();
});
$('#btnNuevaCat').addEventListener('click', () => abrirCategoria(null));

$('#adminListaCats').addEventListener('change', async e => {
  if (e.target.dataset.catActiva) {
    try { await updateDoc(doc(db, COL_CAT, e.target.dataset.catActiva), { activa: e.target.checked }); }
    catch { aviso('No se pudo cambiar la visibilidad', 'mal'); }
  }
  if (e.target.dataset.nombre) {
    const nombre = e.target.value.trim();
    if (!nombre) return pintarListaCatsAdmin();
    try { await updateDoc(doc(db, COL_CAT, e.target.dataset.nombre), { nombre }); aviso('Categoría renombrada', 'ok'); }
    catch { aviso('No se pudo renombrar', 'mal'); }
  }
});
$('#adminListaCats').addEventListener('click', e => {
  const ed = e.target.closest('[data-cat-editar]');
  if (ed) return abrirCategoria(catPorId(ed.dataset.catEditar));
  const bo = e.target.closest('[data-cat-borrar]');
  if (bo) return intentarBorrarCategoria(bo.dataset.catBorrar);
});

/* arrastrar para reordenar categorías */
let catArrastrada = null;
$('#adminListaCats').addEventListener('dragstart', e => {
  const li = e.target.closest('li'); if (!li) return;
  catArrastrada = li.dataset.id; li.classList.add('arrastrando');
});
$('#adminListaCats').addEventListener('dragend', e => e.target.closest('li')?.classList.remove('arrastrando'));
$('#adminListaCats').addEventListener('dragover', e => {
  e.preventDefault();
  const li = e.target.closest('li'); if (li) li.classList.add('sobre-fila');
});
$('#adminListaCats').addEventListener('dragleave', e => e.target.closest('li')?.classList.remove('sobre-fila'));
$('#adminListaCats').addEventListener('drop', async e => {
  e.preventDefault();
  const li = e.target.closest('li'); if (!li || !catArrastrada) return;
  li.classList.remove('sobre-fila');
  const lista = estado.categorias.map(c => c.id);
  const desde = lista.indexOf(catArrastrada), hasta = lista.indexOf(li.dataset.id);
  if (desde < 0 || hasta < 0 || desde === hasta) return;
  lista.splice(hasta, 0, lista.splice(desde, 1)[0]);
  catArrastrada = null;
  const lote = writeBatch(db);
  lista.forEach((id, i) => lote.update(doc(db, COL_CAT, id), { orden: (i + 1) * 10 }));
  try { await lote.commit(); aviso('Orden de categorías guardado', 'ok'); }
  catch (err) { console.error(err); aviso('No se pudo guardar el orden', 'mal'); }
});

/* editor de categoría */
let catId = null;
function abrirCategoria(c) {
  const f = $('#formCategoria'); f.reset();
  catId = c?.id || null;
  $('#catTitulo').textContent = c ? 'Editar categoría' : 'Nueva categoría';
  $('#catBorrar').classList.toggle('oculto', !c);
  if (c) { f.nombre.value = c.nombre; f.descripcion.value = c.descripcion || ''; f.activa.checked = c.activa !== false; }
  else f.activa.checked = true;
  abrir('modalCategoria');
}
$('#formCategoria').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target;
  const id = catId || slug(f.nombre.value);
  if (!id) return;
  try {
    await setDoc(doc(db, COL_CAT, id), {
      nombre: f.nombre.value.trim(), descripcion: f.descripcion.value.trim(),
      activa: f.activa.checked,
      orden: catPorId(id)?.orden ?? ((Math.max(0, ...estado.categorias.map(c => c.orden ?? 0)) + 10) || 10)
    }, { merge: true });
    cerrar($('#modalCategoria')); aviso('Categoría guardada', 'ok');
  } catch (err) { console.error(err); aviso('No se pudo guardar la categoría', 'mal'); }
});
$('#catBorrar').addEventListener('click', () => { cerrar($('#modalCategoria')); intentarBorrarCategoria(catId); });

function intentarBorrarCategoria(id) {
  const usados = estado.productos.filter(p => p.categoria === id);
  const c = catPorId(id);
  if (!usados.length) {
    if (!confirm(`¿Eliminar la categoría “${c.nombre}”?`)) return;
    return deleteDoc(doc(db, COL_CAT, id))
      .then(() => aviso('Categoría eliminada', 'ok'))
      .catch(() => aviso('No se pudo eliminar', 'mal'));
  }
  catId = id;
  $('#mvTexto').textContent = `“${c.nombre}” tiene ${usados.length} ${usados.length === 1 ? 'producto' : 'productos'}. Elige a dónde moverlos antes de eliminarla.`;
  $('#mvDestino').innerHTML = estado.categorias.filter(x => x.id !== id)
    .map(x => `<option value="${x.id}">${esc(x.nombre)}</option>`).join('');
  if (!$('#mvDestino').innerHTML) return aviso('Crea otra categoría antes de eliminar esta.', 'mal');
  abrir('modalMover');
}
$('#mvConfirmar').addEventListener('click', async () => {
  const destino = $('#mvDestino').value;
  const lote = writeBatch(db);
  estado.productos.filter(p => p.categoria === catId)
    .forEach(p => lote.update(doc(db, COL_PROD, p.id), { categoria: destino }));
  lote.delete(doc(db, COL_CAT, catId));
  try { await lote.commit(); cerrar($('#modalMover')); aviso('Productos movidos y categoría eliminada', 'ok'); }
  catch (err) { console.error(err); aviso('No se pudo completar la operación', 'mal'); }
});

/* ═══════════════════════════════════════════════════════════
   11. PANEL: pedidos
   ═══════════════════════════════════════════════════════════ */
const ESTADOS = {
  nuevo: ['Nuevo', 'chip'], cotizacion: ['Por cotizar', 'chip chip--ambar'],
  proceso: ['En proceso', 'chip chip--gris'], listo: ['Listo', 'chip'],
  entregado: ['Entregado', 'chip chip--gris'], cancelado: ['Cancelado', 'chip chip--rojo']
};
const etiquetaEstado = e => {
  const [t, c] = ESTADOS[e] || ['Nuevo', 'chip'];
  return `<span class="${c}">${t}</span>`;
};
$('#filtroEstado').addEventListener('change', pintarPedidos);

function pintarPedidos() {
  const caja = $('#adminPedidos'); if (!caja) return;
  const filtro = $('#filtroEstado').value;
  const lista = filtro ? estado.pedidos.filter(p => p.estado === filtro) : estado.pedidos;
  const nuevos = estado.pedidos.filter(p => p.estado === 'nuevo' || p.estado === 'cotizacion').length;
  $('#badgePedidos').textContent = nuevos;
  $('#badgePedidos').classList.toggle('oculto', !nuevos);
  $('#adminConteoPed').textContent = `${estado.pedidos.length} en total · ${nuevos} sin atender`;

  caja.innerHTML = lista.length ? lista.map(p => {
    const fecha = p.creado?.toDate ? p.creado.toDate().toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' }) : 'Recién creado';
    const tel = String(p.cliente?.telefono || '').replace(/\D/g, '').slice(-10);
    const entrega = p.cliente?.entrega === 'domicilio'
      ? 'Envío a domicilio' + (p.cliente?.direccion ? ' · ' + esc(p.cliente.direccion) : '')
      : 'Recoge en sucursal';
    return `
    <article class="pedido">
      <div class="pedido__cab">
        <div>
          <span class="pedido__folio">${esc(p.folio)}</span> ${etiquetaEstado(p.estado)}
          ${p.archivosPendientes ? '<span class="chip chip--ambar">Falta arte</span>' : ''}
          <div class="pedido__meta">${esc(p.cliente?.nombre || '')} · ${esc(p.cliente?.telefono || '')} · ${esc(p.cliente?.email || '')}</div>
          <div class="pedido__meta">${fecha} · ${entrega}${p.cliente?.empresa ? ' · ' + esc(p.cliente.empresa) : ''}</div>
        </div>
        <select class="campo" style="width:auto" data-estado="${p.id}">
          ${Object.keys(ESTADOS).map(k => `<option value="${k}" ${p.estado === k ? 'selected' : ''}>${ESTADOS[k][0]}</option>`).join('')}
        </select>
      </div>
      <div class="pedido__items">
        ${p.items.map(i => `<div><span>${i.cantidad} × ${esc(i.nombre)}${Object.values(i.opciones || {}).length ? ' · ' + esc(Object.values(i.opciones).join(', ')) : ''}</span><span>${i.cotizacion ? 'Por cotizar' : pesos(i.precio * i.cantidad)}</span></div>`).join('')}
      </div>
      <div class="pedido__total"><span>Total estimado</span><span>${pesos(p.total)}</span></div>
      ${p.archivos?.length ? `<div class="pedido__archivos">
          <strong>Archivos del cliente</strong>
          <ul class="archivos">${p.archivos.map(a => `<li>
            <span class="archivo__icono">${a.tipo === 'application/pdf' ? 'PDF' : 'IMG'}</span>
            <span class="archivo__nombre"><a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.nombre)}</a><small>${kb(a.tamano)}</small></span>
          </li>`).join('')}</ul></div>`
        : `<div class="pedido__archivos pedido__archivos--sin">${p.sinArte ? 'El cliente pidió que EIKON diseñe el arte.' : (p.archivosPendientes ? 'El cliente manda el archivo por WhatsApp.' : 'Sin archivos adjuntos.')}</div>`}
      ${p.cliente?.notas ? `<div class="pedido__notas">${esc(p.cliente.notas)}</div>` : ''}
      <div class="pedido__acciones">
        <a class="btn btn--fantasma" href="https://wa.me/52${tel}?text=${encodeURIComponent(`Hola ${p.cliente?.nombre || ''}, te escribimos de EIKON sobre tu pedido ${p.folio}.`)}" target="_blank" rel="noopener">WhatsApp al cliente</a>
        <a class="btn btn--fantasma" href="mailto:${esc(p.cliente?.email || '')}?subject=${encodeURIComponent('Pedido ' + p.folio + ' — EIKON')}">Enviar correo</a>
        <button class="btn btn--peligro-tenue" type="button" data-borrar-ped="${p.id}">Eliminar</button>
      </div>
    </article>`;
  }).join('')
    : '<div class="vacio"><h3>Sin pedidos por aquí</h3><p>Los pedidos que entren por la tienda aparecen en esta lista.</p></div>';
}

$('#adminPedidos').addEventListener('change', async e => {
  const s = e.target.closest('[data-estado]'); if (!s) return;
  try { await updateDoc(doc(db, COL_PED, s.dataset.estado), { estado: s.value }); aviso('Estado actualizado', 'ok'); }
  catch { aviso('No se pudo actualizar', 'mal'); }
});
$('#adminPedidos').addEventListener('click', async e => {
  const b = e.target.closest('[data-borrar-ped]'); if (!b) return;
  if (!confirm('¿Eliminar este pedido del historial?')) return;
  await deleteDoc(doc(db, COL_PED, b.dataset.borrarPed));
  aviso('Pedido eliminado', 'ok');
});

/* ── Ajustes ────────────────────────────────────────────────── */
$('#formAjustes').addEventListener('submit', async e => {
  e.preventDefault();
  try {
    await setDoc(DOC_CONFIG, Object.fromEntries(new FormData(e.target).entries()), { merge: true });
    aviso('Datos del negocio actualizados', 'ok');
  } catch (err) { console.error(err); aviso('No se pudieron guardar los datos', 'mal'); }
});

/* ═══════════════════════════════════════════════════════════
   12. CATÁLOGO DE EJEMPLO
   ═══════════════════════════════════════════════════════════ */
const SEMILLA_CATS = [
  { id: 'publicidad-exterior', nombre: 'Publicidad exterior', orden: 10, descripcion: 'Lonas, viniles y señalización', activa: true },
  { id: 'folleteria', nombre: 'Folletería', orden: 20, descripcion: 'Trípticos, flyers y folletos', activa: true },
  { id: 'papeleria-comercial', nombre: 'Papelería comercial', orden: 30, descripcion: 'Tarjetas, hojas y folders', activa: true },
  { id: 'editorial', nombre: 'Editorial', orden: 40, descripcion: 'Revistas, libros y memorias', activa: true },
  { id: 'etiquetas', nombre: 'Etiquetas y empaque', orden: 50, descripcion: 'Adheribles para producto', activa: true },
  { id: 'eventos', nombre: 'Eventos e invitaciones', orden: 60, descripcion: 'Invitaciones y boletos', activa: true },
  { id: 'decoracion', nombre: 'Decoración', orden: 70, descripcion: 'Impresión en tela y cuadros', activa: true },
  { id: 'diseno', nombre: 'Diseño y servicios', orden: 80, descripcion: 'Arte, bocetos y retoque', activa: true }
];

const SEMILLA_PROD = [
  ['Lona impresa 13 oz', 'publicidad-exterior', 180, 'm2', 1, 'Lona resistente a intemperie, impresión a todo color.', 'Lona de 13 onzas impresa en alta resolución, ideal para fachadas, promociones y eventos. Se entrega con dobladillo y ojillos cada 50 cm.', [['Terminado', ['Dobladillo y ojillos', 'Bastidor de madera', 'Sin terminado']]], true, true],
  ['Vinil autoadherible con corte', 'publicidad-exterior', 250, 'm2', 1, 'Vinil de corte o impreso para cristales y vehículos.', 'Vinil adherible impreso o de corte, con laminado opcional para mayor duración. Para aparadores, cristales, muros y unidades.', [['Acabado', ['Brillante', 'Mate', 'Esmerilado']]], false, true],
  ['Señalamiento en PVC 3 mm', 'publicidad-exterior', 185, 'pieza', 1, 'Señalización interior de 20 × 30 cm.', 'Placa de PVC espumado de 3 mm con impresión directa. Señalización de seguridad, áreas y protección civil.', [['Medida', ['20 × 30 cm', '30 × 40 cm', '40 × 60 cm']]], false, true],
  ['Rótulo para fachada', 'publicidad-exterior', null, 'servicio', 1, 'Proyecto a medida con instalación.', 'Diseñamos, fabricamos e instalamos el rótulo de tu negocio. Visitamos el lugar para tomar medidas y proponerte materiales.', [], false, true],

  ['Tríptico carta a color', 'folleteria', 1900, 'millar', 1, 'Couché de 150 g, doblado incluido.', 'Tríptico tamaño carta impreso por ambos lados en couché de 150 g, con doblado incluido. Precio por millar; tirajes menores también disponibles.', [['Papel', ['Couché 150 g', 'Couché 250 g', 'Bond 120 g']], ['Doblez', ['Tríptico', 'Díptico']]], true, true],
  ['Cuadríptico carta', 'folleteria', 2400, 'millar', 1, 'Cuatro cuerpos, couché 150 g.', 'Cuadríptico impreso a color por ambos lados, con doblez tipo acordeón o ventana. Ideal para menús y catálogos cortos.', [['Doblez', ['Acordeón', 'Ventana', 'Paralelo']]], false, true],
  ['Flyers media carta', 'folleteria', 950, 'millar', 1, 'Volantes a color, entrega rápida.', 'Volantes en media carta impresos a color en couché de 130 g. La mejor opción para promociones y reparto en calle.', [['Impresión', ['Solo frente', 'Frente y vuelta']]], true, true],
  ['Folleto grapado 8 páginas', 'folleteria', null, 'millar', 1, 'Cuadernillo corto a la medida.', 'Cuadernillo de 8 páginas con grapa al lomo. Cotizamos según papel, tiraje y acabados.', [], false, true],

  ['Tarjetas de presentación', 'papeleria-comercial', 650, 'millar', 1, 'Couché 300 g, frente y vuelta.', 'Tarjetas de presentación en couché de 300 g impresas a color por ambos lados. Con laminado mate o brillante opcional.', [['Laminado', ['Sin laminado', 'Mate', 'Brillante']], ['Esquinas', ['Rectas', 'Redondeadas']]], true, true],
  ['Hojas membretadas', 'papeleria-comercial', 850, 'millar', 1, 'Bond 90 g, tamaño carta.', 'Papelería institucional impresa en bond de 90 g. Incluye ajuste de tu logotipo y datos de contacto.', [], false, true],
  ['Folder institucional', 'papeleria-comercial', 18, 'pieza', 100, 'Con bolsa interior y ranura para tarjeta.', 'Folder en cartulina sulfatada de 12 pt, suajado y pegado, con bolsa interior y ranura para tarjeta de presentación.', [['Laminado', ['Mate', 'Brillante']]], false, true],
  ['Impresión láser carta a color', 'papeleria-comercial', 6, 'pieza', 10, 'Para tirajes cortos y urgentes.', 'Impresión láser a color en tamaño carta. Ideal cuando necesitas pocas copias con buena calidad y de inmediato.', [['Papel', ['Bond 75 g', 'Opalina 125 g', 'Couché 150 g']], ['Impresión', ['Solo frente', 'Frente y vuelta']]], false, true],

  ['Revista grapada a color', 'editorial', null, 'millar', 1, 'De 16 a 48 páginas.', 'Revista con grapa al lomo, interiores en couché y portada en cartulina. Cotizamos según número de páginas y tiraje.', [], true, true],
  ['Libro encuadernado rústico', 'editorial', null, 'pieza', 50, 'Pegado hotmelt, portada a color.', 'Libro con encuadernación rústica (pegado hotmelt), interiores en bond o couché y portada laminada. Incluye revisión de archivo.', [], false, true],
  ['Memoria de evento', 'editorial', null, 'pieza', 30, 'Recopilación impresa de tu congreso.', 'Memoria impresa para congresos, informes y aniversarios. Diseño editorial, armado de contenidos e impresión.', [], false, true],

  ['Etiquetas adheribles en rollo', 'etiquetas', 1200, 'millar', 1, 'Couché adherible troquelado.', 'Etiquetas impresas a color en papel couché adherible, entregadas en rollo o en hoja. Cualquier forma de troquel.', [['Forma', ['Circular', 'Rectangular', 'Troquel especial']], ['Acabado', ['Mate', 'Brillante']]], true, true],
  ['Etiqueta para producto', 'etiquetas', 890, 'millar', 1, 'Para frascos, bolsas y cajas.', 'Etiqueta de producto con impresión a color y laminado protector, resistente a manipulación y humedad ligera.', [['Material', ['Couché adherible', 'Vinil blanco', 'Transparente']]], false, true],

  ['Invitaciones con sobre', 'eventos', 28, 'pieza', 50, 'Opalina 225 g, sobre incluido.', 'Invitación impresa en opalina de 225 g con sobre. Bodas, XV años, graduaciones y eventos de empresa.', [['Acabado', ['Impresión a color', 'Con hot stamping', 'Con relieve']], ['Sobre', ['Blanco', 'De color', 'Sin sobre']]], true, true],
  ['Boletos numerados', 'eventos', 1100, 'millar', 1, 'Con folio y talón desprendible.', 'Boletos con numeración consecutiva, talón desprendible y perforado. Para rifas, funciones y eventos con control de acceso.', [['Talón', ['Con talón', 'Sin talón']]], false, true],
  ['Gafetes para evento', 'eventos', 22, 'pieza', 50, 'Con porta gafete y cordón.', 'Gafete impreso a color en opalina o PVC, con porta gafete y cordón. Personalizable con nombre de cada asistente.', [['Material', ['Opalina', 'PVC']]], false, true],

  ['Cuadro impreso en tela canvas', 'decoracion', 690, 'pieza', 1, 'Canvas 40 × 60 cm con bastidor.', 'Impresión de tu fotografía o diseño en tela canvas, montada en bastidor de madera y lista para colgar.', [['Medida', ['30 × 40 cm', '40 × 60 cm', '60 × 90 cm']], ['Bastidor', ['Con bastidor', 'Solo la tela']]], true, true],
  ['Cuadro decorativo en tela 60 × 90', 'decoracion', 1150, 'pieza', 1, 'Formato grande para sala u oficina.', 'Impresión en tela de formato grande con tintas resistentes a la luz. Montaje en bastidor reforzado.', [], false, true],

  ['Diseño de logotipo', 'diseno', 2500, 'servicio', 1, 'Tres propuestas y archivos finales.', 'Desarrollo de logotipo: entrevista, bocetos, tres propuestas, dos rondas de ajustes y entrega de archivos editables para impresión y redes.', [], true, true],
  ['Diseño de pieza gráfica', 'diseno', 450, 'servicio', 1, 'Flyer, post o lona a partir de tu información.', 'Diseño de una pieza gráfica lista para imprimir o publicar. Incluye una ronda de cambios.', [['Formato', ['Impreso', 'Redes sociales', 'Ambos']]], false, true],
  ['Retoque digital de fotografía', 'diseno', 180, 'pieza', 1, 'Limpieza, color y recorte profesional.', 'Retoque profesional por imagen: corrección de color, limpieza de fondo, recorte y preparación para impresión.', [['Trabajo', ['Retoque básico', 'Recorte de fondo', 'Restauración de foto antigua']]], false, true],
  ['Desarrollo de boceto', 'diseno', null, 'servicio', 1, 'Propuesta visual antes de producir.', 'Boceto a escala de tu proyecto de señalización, stand o rotulación, para que veas cómo quedará antes de imprimir.', [], false, true]
];

$('#btnSembrar').addEventListener('click', async () => {
  if (!estado.esAdmin) return;
  if (!confirm('Se agregarán categorías y productos de ejemplo. Los que ya existan con el mismo nombre se sobrescriben. ¿Continuar?')) return;
  const btn = $('#btnSembrar');
  btn.disabled = true; btn.textContent = 'Cargando…';
  try {
    let lote = writeBatch(db);
    SEMILLA_CATS.forEach(c => lote.set(doc(db, COL_CAT, c.id), c, { merge: true }));
    await lote.commit();

    lote = writeBatch(db);
    SEMILLA_PROD.forEach((p, i) => {
      const [nombre, categoria, precio, unidad, minimo, corta, larga, opciones, destacado, activo] = p;
      lote.set(doc(db, COL_PROD, slug(nombre)), {
        nombre, categoria, precio, unidad, minimo,
        descripcionCorta: corta, descripcion: larga,
        opciones: opciones.map(([n, v]) => ({ nombre: n, valores: v })),
        cotizacion: precio === null, precioDesde: unidad === 'millar',
        destacado, activo, orden: (i + 1) * 10,
        sku: 'EK-' + String(i + 1).padStart(3, '0'),
        imagenes: [], actualizado: serverTimestamp()
      }, { merge: true });
    });
    await lote.commit();

    await setDoc(DOC_CONFIG, {
      telefono: estado.config.telefono || '771 000 0000',
      whatsapp: estado.config.whatsapp || '527710000000',
      email: estado.config.email || 'ventas@eikon.mx',
      direccion: estado.config.direccion || 'Tizayuca, Hidalgo',
      horario: estado.config.horario || 'Lun a Vie 9:00–18:00 · Sáb 9:00–14:00'
    }, { merge: true });

    aviso('Catálogo de ejemplo cargado', 'ok');
  } catch (err) { console.error(err); aviso('No se pudo cargar el catálogo. Revisa las reglas de Firestore.', 'mal'); }
  finally { btn.disabled = false; btn.textContent = 'Cargar catálogo de ejemplo'; }
});

/* ═══════════════════════════════════════════════════════════
   13. DETALLE: profundidad en la mesa del inicio
   ═══════════════════════════════════════════════════════════ */
const mesa = $('#heroMesa');
if (mesa && window.matchMedia('(prefers-reduced-motion: no-preference)').matches && window.matchMedia('(pointer: fine)').matches) {
  const piezas = $$('[data-prof]', mesa);
  mesa.addEventListener('pointermove', e => {
    const r = mesa.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - .5;
    const y = (e.clientY - r.top) / r.height - .5;
    piezas.forEach(p => {
      const d = Number(p.dataset.prof) / 10;
      const giro = getComputedStyle(p).getPropertyValue('--giro') || '0deg';
      p.style.transform = `translate3d(${-x * d}px, ${-y * d}px, 0) rotate(${giro})`;
    });
  });
  mesa.addEventListener('pointerleave', () => {
    piezas.forEach(p => {
      const giro = getComputedStyle(p).getPropertyValue('--giro') || '0deg';
      p.style.transform = `rotate(${giro})`;
    });
  });
}

/* ── Arranque ───────────────────────────────────────────────── */
aplicarModoCuenta();
pintarCarrito();
pintarCatalogo();