// ─── Modal: Nuevo Chat ────────────────────────────────────────

let usuarioSeleccionado = null;
let buscarTimeout = null;
let _todosLosUsuarios = null;

// Abrir modal y cargar lista de usuarios inmediatamente
function abrirModalNuevoChat() {
    usuarioSeleccionado = null;
    document.getElementById("buscarAliasInput").value = "";
    document.getElementById("btnCrearChat").disabled = true;
    document.getElementById("btnCrearChat").style.opacity = "0.5";
    document.getElementById("modalNuevoChat").classList.add("open");
    mostrarUsuarios("");
    setTimeout(() => document.getElementById("buscarAliasInput").focus(), 100);
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

// Fetch usuarios una sola vez y cachear
async function cargarTodosLosUsuarios() {
    if (_todosLosUsuarios) return _todosLosUsuarios;
    const token = localStorage.getItem("token");
    const res = await fetch(API_URL + "/api/chats/users", {
        headers: { "Authorization": "Bearer " + token }
    });
    const data = await res.json();
    // Excluir al usuario actual
    _todosLosUsuarios = (data || []).filter(u => (u.IdUsuario ?? u.id) != window.usuarioId);
    return _todosLosUsuarios;
}

// Renderizar lista filtrada
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
            resultado.innerHTML = '<span style="color:#e74c3c; font-size:13px;">No se encontró ningún usuario</span>';
            return;
        }

        resultado.innerHTML = "";
        filtrados.slice(0, 20).forEach(u => {
            const id     = u.IdUsuario ?? u.id;
            const alias  = u.Alias  ?? u.alias  ?? "?";
            const nombre = u.Nombre ?? u.nombre ?? "";

            const div = document.createElement("div");
            div.className = "usuario-resultado";
            div.innerHTML =
                '<div class="avatar">' + alias[0].toUpperCase() + '</div>' +
                '<div><strong>' + alias + '</strong>' +
                '<div style="font-size:12px; color:#888;">' + nombre + '</div></div>';
            div.onclick = () => seleccionarUsuario({ id, alias, nombre }, div);
            resultado.appendChild(div);
        });
    } catch (err) {
        console.error(err);
        resultado.innerHTML = '<span style="color:#e74c3c; font-size:13px;">Error al cargar usuarios</span>';
    }
}

// Filtrar al escribir (debounce 250ms)
async function buscarUsuario() {
    clearTimeout(buscarTimeout);
    const texto = document.getElementById("buscarAliasInput").value.trim().toLowerCase();
    buscarTimeout = setTimeout(() => mostrarUsuarios(texto), 250);
}

// Marcar usuario seleccionado
function seleccionarUsuario(usuario, elem) {
    usuarioSeleccionado = usuario;
    document.querySelectorAll(".usuario-resultado").forEach(el => el.classList.remove("seleccionado"));
    elem.classList.add("seleccionado");
    document.getElementById("btnCrearChat").disabled = false;
    document.getElementById("btnCrearChat").style.opacity = "1";
}

// Crear chat con el usuario seleccionado
async function crearChatConUsuario() {
    if (!usuarioSeleccionado) return;
    const btn = document.getElementById("btnCrearChat");
    btn.textContent = "Creando...";
    btn.disabled = true;
    try {
        const token = localStorage.getItem("token");
        const res = await fetch(API_URL + "/api/chats", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
            body: JSON.stringify({ usuarioDestino: usuarioSeleccionado.id })
        });
        const data = await res.json();
        if (data && data.IdChat) {
            cerrarModalNuevoChat();
            await cargarChats();
            abrirChat(data.IdChat, usuarioSeleccionado.alias);
        } else {
            alert(data.message || "No se pudo crear el chat");
        }
    } catch (err) {
        alert("Error al crear el chat");
    } finally {
        btn.textContent = "Iniciar Chat";
        btn.disabled = false;
        btn.style.opacity = "1";
    }
}