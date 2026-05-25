// ─── Modal: Nuevo Chat ────────────────────────────────────────

let usuarioSeleccionado = null;
let buscarTimeout = null;
let _todosLosUsuarios = null;

// ── Abrir modal ───────────────────────────────────────────────
function abrirModalNuevoChat() {
    usuarioSeleccionado = null;
    document.getElementById("nombreChatInput").value = "";
    document.getElementById("buscarAliasInput").value = "";
    document.getElementById("resultadoBusqueda").innerHTML = "";
    document.getElementById("contadorNombre").textContent = "0";
    document.getElementById("mensajeErrorChat").style.display = "none";
    document.getElementById("usuarioSeleccionadoTag").style.display = "none";
    document.getElementById("btnCrearChat").disabled = true;
    document.getElementById("btnCrearChat").style.opacity = "0.5";
    document.getElementById("modalNuevoChat").classList.add("open");
    mostrarUsuarios("");
    setTimeout(() => document.getElementById("nombreChatInput").focus(), 100);
}

function cerrarModalNuevoChat() {
    document.getElementById("modalNuevoChat").classList.remove("open");
}

// Cerrar al hacer clic en el fondo
document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("modalNuevoChat").addEventListener("click", function (e) {
        if (e.target === this) cerrarModalNuevoChat();
    });
});

// ── Validar que el nombre no esté vacío para habilitar el botón ──
function validarFormularioChat() {
    const nombre = document.getElementById("nombreChatInput").value.trim();
    const contador = document.getElementById("contadorNombre");
    const btn = document.getElementById("btnCrearChat");

    contador.textContent = document.getElementById("nombreChatInput").value.length;

    const valido = nombre.length > 0 && nombre.length <= 30;
    btn.disabled = !valido;
    btn.style.opacity = valido ? "1" : "0.5";
}

// ── Cargar usuarios (cache) ───────────────────────────────────
async function cargarTodosLosUsuarios() {
    if (_todosLosUsuarios) return _todosLosUsuarios;
    const token = localStorage.getItem("token");
    const res = await fetch(API_URL + "/api/chats/users", {
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
        const todos = await cargarTodosLosUsuarios();
        const filtrados = texto.length === 0
            ? todos
            : todos.filter(u =>
                (u.Alias || u.alias || "").toLowerCase().includes(texto) ||
                (u.Nombre || u.nombre || "").toLowerCase().includes(texto)
            );

        if (filtrados.length === 0) {
            resultado.innerHTML = '<span style="color:#888; font-size:13px;">No se encontraron usuarios</span>';
            return;
        }

        resultado.innerHTML = "";
        filtrados.slice(0, 20).forEach(u => {
            const id     = u.IdUsuario ?? u.id;
            const alias  = u.Alias  ?? u.alias  ?? "?";
            const nombre = u.Nombre ?? u.nombre ?? "";

            // No mostrar si ya está seleccionado
            if (usuarioSeleccionado && usuarioSeleccionado.id == id) return;

            const div = document.createElement("div");
            div.className = "usuario-resultado";
            div.innerHTML =
                '<div class="avatar">' + alias[0].toUpperCase() + '</div>' +
                '<div><strong>' + alias + '</strong>' +
                '<div style="font-size:12px; color:#888;">' + nombre + '</div></div>';
            div.onclick = () => seleccionarUsuario({ id, alias, nombre });
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

// ── Seleccionar / deseleccionar usuario ───────────────────────
function seleccionarUsuario(usuario) {
    usuarioSeleccionado = usuario;

    // Mostrar tag del usuario seleccionado
    const tag = document.getElementById("usuarioSeleccionadoTag");
    document.getElementById("usuarioSeleccionadoNombre").textContent = "👤 " + usuario.alias + (usuario.nombre ? " — " + usuario.nombre : "");
    tag.style.display = "flex";

    // Limpiar la lista de resultados
    document.getElementById("buscarAliasInput").value = "";
    document.getElementById("resultadoBusqueda").innerHTML = "";
}

function deseleccionarUsuario() {
    usuarioSeleccionado = null;
    document.getElementById("usuarioSeleccionadoTag").style.display = "none";
    mostrarUsuarios("");
}

// ── Crear chat ────────────────────────────────────────────────
async function crearChatConUsuario() {
    const nombre = document.getElementById("nombreChatInput").value.trim();
    const errorDiv = document.getElementById("mensajeErrorChat");

    if (!nombre) {
        errorDiv.textContent = "El nombre del chat es obligatorio";
        errorDiv.style.display = "block";
        return;
    }

    errorDiv.style.display = "none";
    const btn = document.getElementById("btnCrearChat");
    btn.textContent = "Creando...";
    btn.disabled = true;

    try {
        const token = localStorage.getItem("token");

        // Solo enviamos `nombre` — el backend (SP_CrearChat) no acepta usuarioDestino
        // Si en el futuro quieres agregar participantes, hazlo en una llamada separada
        const body = { nombre };

        const res = await fetch(API_URL + "/api/chats", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
            body: JSON.stringify(body)
        });

        // Verificar que la respuesta HTTP sea exitosa antes de parsear JSON
        if (!res.ok) {
            const texto = await res.text();
            console.error("HTTP error al crear chat:", res.status, texto);
            errorDiv.textContent = `Error del servidor (${res.status})`;
            errorDiv.style.display = "block";
            return;
        }

        const data = await res.json();
        console.log("Respuesta al crear chat:", data); // 👈 útil para depurar

        // El backend devuelve id_chat (minúsculas), pero cubrimos ambas variantes
        const idChat = data.id_chat ?? data.IdChat ?? data.id ?? null;

        if (data.success && idChat) {
            cerrarModalNuevoChat();
            await cargarChats();
            abrirChat(idChat, nombre);
        } else {
            // Mostrar el mensaje exacto que devuelve el backend
            errorDiv.textContent = data.message || `No se pudo crear el chat (id: ${idChat})`;
            errorDiv.style.display = "block";
        }
    } catch (err) {
        // Error de red o JSON inválido
        console.error("Excepción al crear chat:", err);
        errorDiv.textContent = "Error de red al conectar con el servidor";
        errorDiv.style.display = "block";
    } finally {
        btn.textContent = "Crear Chat";
        btn.disabled = false;
        btn.style.opacity = "1";
    }
}