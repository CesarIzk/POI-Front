// ─── Modal: Nuevo Chat (múltiples participantes) ──────────────

let usuariosSeleccionados = [];   // ← ahora es un array
let buscarTimeout         = null;
let _todosLosUsuarios     = null;

// ── Abrir modal ───────────────────────────────────────────────
function abrirModalNuevoChat() {
    usuariosSeleccionados = [];
    document.getElementById("nombreChatInput").value    = "";
    document.getElementById("buscarAliasInput").value   = "";
    document.getElementById("resultadoBusqueda").innerHTML = "";
    document.getElementById("contadorNombre").textContent  = "0";
    document.getElementById("mensajeErrorChat").style.display = "none";
    document.getElementById("usuariosSeleccionadosContainer").innerHTML = "";
    document.getElementById("btnCrearChat").disabled    = true;
    document.getElementById("btnCrearChat").style.opacity = "0.5";
    document.getElementById("modalNuevoChat").classList.add("open");
    mostrarUsuarios("");
    setTimeout(() => document.getElementById("nombreChatInput").focus(), 100);
}

function cerrarModalNuevoChat() {
    document.getElementById("modalNuevoChat").classList.remove("open");
}

document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("modalNuevoChat").addEventListener("click", function (e) {
        if (e.target === this) cerrarModalNuevoChat();
    });
});

// ── Validar nombre ────────────────────────────────────────────
function validarFormularioChat() {
    const nombre  = document.getElementById("nombreChatInput").value.trim();
    const contador = document.getElementById("contadorNombre");
    const btn     = document.getElementById("btnCrearChat");
    contador.textContent = document.getElementById("nombreChatInput").value.length;
    const valido  = nombre.length > 0 && nombre.length <= 30;
    btn.disabled  = !valido;
    btn.style.opacity = valido ? "1" : "0.5";
}

// ── Cargar usuarios (cache) ───────────────────────────────────
async function cargarTodosLosUsuarios() {
    if (_todosLosUsuarios) return _todosLosUsuarios;
    const token = localStorage.getItem("token");
    const res   = await fetch(API_URL + "/api/chats/users", {
        headers: { "Authorization": "Bearer " + token }
    });
    const data = await res.json();
    _todosLosUsuarios = (data || []).filter(u => (u.IdUsuario ?? u.id) != window.usuarioId);
    return _todosLosUsuarios;
}

// ── Renderizar lista filtrada ─────────────────────────────────
async function mostrarUsuarios(texto) {
    const resultado = document.getElementById("resultadoBusqueda");
    resultado.innerHTML = '<span style="color:#888; font-size:13px;">Cargando...</span>';
    try {
        const todos     = await cargarTodosLosUsuarios();
        const idsYa     = new Set(usuariosSeleccionados.map(u => String(u.id)));
        const filtrados = (texto.length === 0 ? todos : todos.filter(u =>
            (u.Alias || u.alias || "").toLowerCase().includes(texto) ||
            (u.Nombre || u.nombre || "").toLowerCase().includes(texto)
        )).filter(u => !idsYa.has(String(u.IdUsuario ?? u.id)));  // ocultar ya agregados

        if (filtrados.length === 0) {
            resultado.innerHTML = '<span style="color:#888; font-size:13px;">No se encontraron usuarios</span>';
            return;
        }

        resultado.innerHTML = "";
        filtrados.slice(0, 20).forEach(u => {
            const id     = u.IdUsuario ?? u.id;
            const alias  = u.Alias  ?? u.alias  ?? "?";
            const nombre = u.Nombre ?? u.nombre ?? "";
            const div    = document.createElement("div");
            div.className = "usuario-resultado";
            div.innerHTML =
                '<div class="avatar">' + alias[0].toUpperCase() + '</div>' +
                '<div><strong>' + alias + '</strong>' +
                '<div style="font-size:12px; color:#888;">' + nombre + '</div></div>' +
                '<span style="margin-left:auto; font-size:18px; color:#5865f2; font-weight:bold;">+</span>';
            div.onclick = () => agregarUsuario({ id, alias, nombre });
            resultado.appendChild(div);
        });
    } catch (err) {
        console.error(err);
        resultado.innerHTML = '<span style="color:#e74c3c; font-size:13px;">Error al cargar usuarios</span>';
    }
}

// ── Filtrar al escribir ───────────────────────────────────────
async function buscarUsuario() {
    clearTimeout(buscarTimeout);
    const texto = document.getElementById("buscarAliasInput").value.trim().toLowerCase();
    buscarTimeout = setTimeout(() => mostrarUsuarios(texto), 250);
}

// ── Agregar usuario a la selección ───────────────────────────
function agregarUsuario(usuario) {
    // Evitar duplicados
    if (usuariosSeleccionados.find(u => u.id == usuario.id)) return;

    usuariosSeleccionados.push(usuario);
    renderTagsUsuarios();

    // Limpiar búsqueda y refrescar lista (ya no aparece el agregado)
    document.getElementById("buscarAliasInput").value = "";
    mostrarUsuarios("");
}

// ── Quitar usuario de la selección ───────────────────────────
function quitarUsuario(id) {
    usuariosSeleccionados = usuariosSeleccionados.filter(u => u.id != id);
    renderTagsUsuarios();
    mostrarUsuarios(document.getElementById("buscarAliasInput").value.trim().toLowerCase());
}

// ── Renderizar tags de usuarios seleccionados ─────────────────
function renderTagsUsuarios() {
    const container = document.getElementById("usuariosSeleccionadosContainer");
    container.innerHTML = "";

    if (usuariosSeleccionados.length === 0) return;

    // Mostrar conteo
    const label = document.createElement("span");
    label.style.cssText = "font-size:11px; color:#888; width:100%; margin-bottom:2px;";
    label.textContent   = usuariosSeleccionados.length + " participante" + (usuariosSeleccionados.length > 1 ? "s" : "") + " agregado" + (usuariosSeleccionados.length > 1 ? "s" : "");
    container.appendChild(label);

    usuariosSeleccionados.forEach(u => {
        const tag = document.createElement("div");
        tag.className = "tag-usuario";
        tag.innerHTML =
            '<span>' + u.alias + '</span>' +
            '<span class="tag-remove" onclick="quitarUsuario(' + u.id + ')">✕</span>';
        container.appendChild(tag);
    });
}

// ── Crear chat con múltiples participantes ────────────────────
async function crearChatConUsuario() {
    const nombre   = document.getElementById("nombreChatInput").value.trim();
    const errorDiv = document.getElementById("mensajeErrorChat");

    if (!nombre) {
        errorDiv.textContent = "El nombre del chat es obligatorio";
        errorDiv.style.display = "block";
        return;
    }

    errorDiv.style.display = "none";
    const btn = document.getElementById("btnCrearChat");
    btn.textContent = "Creando...";
    btn.disabled    = true;

    try {
        const token = localStorage.getItem("token");

        // Mandar nombre + array de ids de participantes
        const body = {
            nombre,
            participantes: usuariosSeleccionados.map(u => u.id)
        };

        const res = await fetch(API_URL + "/api/chats", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
            body: JSON.stringify(body)
        });

        if (!res.ok) {
            errorDiv.textContent = `Error del servidor (${res.status})`;
            errorDiv.style.display = "block";
            return;
        }

        const data   = await res.json();
        const idChat = data.id_chat ?? data.IdChat ?? null;

        if (data.success && idChat) {
            cerrarModalNuevoChat();
            await cargarChats();
            abrirChat(idChat, nombre);
        } else {
            errorDiv.textContent = data.message || "No se pudo crear el chat";
            errorDiv.style.display = "block";
        }
    } catch (err) {
        console.error("Error creando chat:", err);
        errorDiv.textContent = "Error de red al conectar con el servidor";
        errorDiv.style.display = "block";
    } finally {
        btn.textContent = "Crear Chat";
        btn.disabled    = false;
        btn.style.opacity = "1";
    }
}