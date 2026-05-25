// ─────────────────────────────────────────────────────────────
// chat.js — Cliente frontend
// ─────────────────────────────────────────────────────────────

const API_URL = "https://poi-back-production-7931.up.railway.app";

// ── Conexión Socket.IO ────────────────────────────────────────
const token = localStorage.getItem("token");

window.socket = io(API_URL, {
    auth: { token },
    transports: ["websocket", "polling"]
});

window.socket.on("connect", () => {
    console.log("✅ Socket conectado:", window.socket.id);
    // Si ya había un chat abierto, rejoinearlo
    if (window.currentChat) {
        window.socket.emit("joinChat", window.currentChat);
    }
});

window.socket.on("connect_error", (err) => {
    console.error("❌ Socket error:", err.message);
});

// ── Estado global ─────────────────────────────────────────────
window.currentChat     = null;
window.currentChatName = null;

// ── Cargar lista de chats ─────────────────────────────────────
async function cargarChats() {
    try {
        const res  = await fetch(API_URL + "/api/chats", {
            headers: { "Authorization": "Bearer " + token }
        });
        const data = await res.json();
        renderizarChats(Array.isArray(data) ? data : []);
    } catch (err) {
        console.error("Error cargando chats:", err);
    }
}

function renderizarChats(chats) {
    const lista = document.getElementById("chatList");
    lista.innerHTML = "";

    if (chats.length === 0) {
        lista.innerHTML = '<p style="color:#666; font-size:13px; padding:8px 4px;">Sin chats aún. ¡Crea uno!</p>';
        return;
    }

    chats.forEach(chat => {
        const id     = chat.IdChat   ?? chat.id_chat ?? chat.id;
        const nombre = chat.NombreChat ?? chat.nombre ?? "Chat";

        const div = document.createElement("div");
        div.className = "chat-item" + (window.currentChat == id ? " active" : "");
        div.innerHTML =
            '<div class="chat-avatar">' + nombre[0].toUpperCase() + '</div>' +
            '<div class="chat-info">' +
                '<div class="chat-name">' + nombre + '</div>' +
            '</div>';
        div.onclick = () => abrirChat(id, nombre);
        lista.appendChild(div);
    });
}

// ── Abrir un chat ─────────────────────────────────────────────
async function abrirChat(idChat, nombre) {
    // Salir del chat anterior en el socket
    if (window.currentChat && window.currentChat !== idChat) {
        window.socket.emit("leaveChat", window.currentChat);
    }

    window.currentChat     = idChat;
    window.currentChatName = nombre;

    document.getElementById("chatTitle").textContent = nombre;
    document.getElementById("mensajeInput").disabled = false;

    // Marcar activo en la lista
    document.querySelectorAll(".chat-item").forEach(el => el.classList.remove("active"));
    const items = document.querySelectorAll(".chat-item");
    items.forEach(el => {
        if (el.querySelector(".chat-name")?.textContent === nombre) el.classList.add("active");
    });

    // Unirse al room del socket
    window.socket.emit("joinChat", idChat);

    // Cargar mensajes históricos
    await cargarMensajes(idChat);

    // Cargar tareas del sidebar
    if (typeof cargarTareasSidebar === "function") cargarTareasSidebar(idChat);

    // Disparar evento para cerrar sidebar móvil
    document.dispatchEvent(new Event("chatSeleccionado"));
}

// ── Cargar mensajes ───────────────────────────────────────────
async function cargarMensajes(idChat) {
    const area = document.getElementById("messages");
    area.innerHTML = '<p style="color:#555; font-size:13px; text-align:center; margin-top:40px;">Cargando mensajes...</p>';

    try {
        const res  = await fetch(API_URL + "/api/chats/" + idChat + "/messages", {
            headers: { "Authorization": "Bearer " + token }
        });
        const data = await res.json();
        const msgs = Array.isArray(data) ? data : [];

        area.innerHTML = "";
        msgs.forEach(m => agregarMensajeDOM(m, false));
        scrollAbajo();
    } catch (err) {
        console.error("Error cargando mensajes:", err);
        area.innerHTML = '<p style="color:#e74c3c; font-size:13px; text-align:center;">Error al cargar mensajes</p>';
    }
}

// ── Renderizar un mensaje en el DOM ───────────────────────────
function agregarMensajeDOM(msg, scroll = true) {
    const area      = document.getElementById("messages");
    const esPropio  = String(msg.IdUsuario ?? msg.id_usuario) === String(window.usuarioId);
    const texto     = msg.Mensaje   ?? msg.mensaje   ?? "";
    const alias     = msg.Alias     ?? msg.alias     ?? "Usuario";
    const esCoach   = msg.EsCoach   ?? msg.es_coach  ?? false;

    // Formatear hora
    const fecha = msg.FechaEnvio ?? msg.fecha_envio ?? null;
    let hora = "";
    if (fecha) {
        const d = new Date(fecha);
        hora = d.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
    }

    const div = document.createElement("div");
    div.className = "message" + (esPropio ? " own" : "") + (esCoach ? " coach-bubble" : "");

    if (!esPropio && !esCoach) {
        div.innerHTML += '<div class="msg-alias">' + alias + '</div>';
    }
    div.innerHTML +=
        '<div class="msg-text">' + escapeHtml(texto) + '</div>' +
        (hora ? '<div class="msg-time">' + hora + '</div>' : '');

    area.appendChild(div);
    if (scroll) scrollAbajo();
}

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function scrollAbajo() {
    const area = document.getElementById("messages");
    area.scrollTop = area.scrollHeight;
}

// ── Enviar mensaje ────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
    const form = document.getElementById("chatForm");
    if (!form) return;

    form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const input   = document.getElementById("mensajeInput");
        const mensaje = input.value.trim();
        if (!mensaje || !window.currentChat) return;

        input.value = "";

        try {
            await fetch(API_URL + "/api/chats/" + window.currentChat + "/messages", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": "Bearer " + token
                },
                body: JSON.stringify({ mensaje })
            });
            // El mensaje llegará por socket (nuevoMensaje) para todos incluyendo el emisor
        } catch (err) {
            console.error("Error enviando mensaje:", err);
        }
    });

    // Cargar chats al iniciar
    cargarChats();
});

// ── Socket: recibir mensajes en tiempo real ───────────────────
window.socket.on("nuevoMensaje", (msg) => {
    if (String(msg.id_chat ?? msg.IdChat) !== String(window.currentChat)) return;
    agregarMensajeDOM(msg, true);
});

// ── Socket: alguien se unió / salió (opcional, para logs) ─────
window.socket.on("usuarioUnido", (data) => {
    console.log("Usuario unido al chat:", data);
});

// ── Tareas sidebar (stubs — implementa según tu API) ──────────
async function cargarTareasSidebar(idChat) {
    const lista = document.getElementById("sidebarTaskList");
    if (!lista) return;
    lista.innerHTML = '<li style="color:#666;font-size:12px;padding:6px 0">Cargando...</li>';

    try {
        const res  = await fetch(API_URL + "/api/tareas?id_chat=" + idChat, {
            headers: { "Authorization": "Bearer " + token }
        });
        const data = await res.json();
        const tareas = Array.isArray(data) ? data : [];

        lista.innerHTML = "";
        if (tareas.length === 0) {
            lista.innerHTML = '<li style="color:#666;font-size:12px;padding:6px 0">Sin tareas</li>';
            return;
        }
        tareas.forEach(t => {
            const li = document.createElement("li");
            li.style.cssText = "font-size:12px; color:#ccc; padding:5px 0; border-bottom:1px solid #2a2a3e;";
            li.textContent = (t.Descripcion ?? t.descripcion ?? "Tarea") +
                             " (" + (t.Puntos ?? t.puntos ?? 0) + " EXP)";
            lista.appendChild(li);
        });
    } catch {
        lista.innerHTML = '<li style="color:#666;font-size:12px;padding:6px 0">Sin tareas</li>';
    }
}

function abrirModalTarea() {
    const modal = document.getElementById("modalNuevaTarea");
    if (modal) modal.style.display = "flex";
}

function cerrarModalTarea() {
    const modal = document.getElementById("modalNuevaTarea");
    if (modal) modal.style.display = "none";
}

async function crearTareaManual() {
    const desc   = document.getElementById("nuevaTareaDesc")?.value.trim();
    const puntos = document.getElementById("nuevaTareaPuntos")?.value;
    const dias   = document.getElementById("nuevaTareaDias")?.value;

    if (!desc) return;

    try {
        await fetch(API_URL + "/api/tareas", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": "Bearer " + token
            },
            body: JSON.stringify({
                descripcion: desc,
                puntos: Number(puntos),
                dias_limite: Number(dias),
                id_chat: window.currentChat
            })
        });
        cerrarModalTarea();
        mostrarToast("✅ Tarea creada");
        if (window.currentChat) cargarTareasSidebar(window.currentChat);
    } catch (err) {
        console.error("Error creando tarea:", err);
    }
}

function mostrarToast(msg) {
    const toast = document.getElementById("toastTarea");
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.add("show");
    setTimeout(() => toast.classList.remove("show"), 3000);
}