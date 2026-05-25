// ─────────────────────────────────────────────────────────────
// chat.js — Cliente frontend (con soporte grupal + coach IA)
// ─────────────────────────────────────────────────────────────

const API_URL = "https://poi-back-production-7931.up.railway.app";

// ── Socket.IO ─────────────────────────────────────────────────
const socket = io(API_URL);
window.socket = socket;

socket.on("connect", () => {
    console.log("🔌 Socket conectado:", socket.id);
    socket.emit("register", usuarioId);
    if (currentChat) socket.emit("joinChat", currentChat);
});

// ── Referencias DOM ───────────────────────────────────────────
const chatList    = document.getElementById("chatList");
const messagesDiv = document.getElementById("messages");
const form        = document.getElementById("chatForm");
const input       = document.getElementById("mensajeInput");

// ── Estado ────────────────────────────────────────────────────
let currentChat    = null;
window.currentChat = null;
let historialCoach = [];
let tareasActivas  = [];

const usuarioId = window.usuarioId;

function authHeaders() {
    const token = localStorage.getItem("token");
    return {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
    };
}

// ═══════════════════════════════════════════════════════════
//  SOCKET — mensajes en tiempo real
// ═══════════════════════════════════════════════════════════
socket.on("receiveMessage", (data) => {
    if (parseInt(data.chatId) !== parseInt(currentChat)) return;
    const lado = (data.usuario == usuarioId) ? "right" : "left";
    agregarBurbuja({
        lado,
        nombre: data.usuario == usuarioId ? "Tú" : (data.nombreRemitente || "Usuario"),
        texto:  data.mensaje
    });
});

// ═══════════════════════════════════════════════════════════
//  CHATS — cargar lista
// ═══════════════════════════════════════════════════════════
async function cargarChats() {
    try {
        const res   = await fetch(`${API_URL}/api/chats`, { headers: authHeaders() });
        const chats = await res.json();
        chatList.innerHTML = "";

        if (!chats?.length) {
            chatList.innerHTML = "<p style='color:#666;font-size:13px;padding:8px'>No tienes chats aún</p>";
            return;
        }

        chats.forEach(chat => {
            const id     = chat.IdChat;
            const nombre = chat.NombreChatVisual ?? chat.NombreChat ?? "Chat";
            const inicial = nombre[0]?.toUpperCase() ?? "C";

            const div = document.createElement("div");
            div.className = "chat-item" + (currentChat == id ? " active" : "");
            div.innerHTML =
                `<div class="chat-avatar">${inicial}</div>` +
                `<div class="chat-info"><div class="chat-name">${nombre}</div></div>`;
            div.onclick = () => abrirChat(id, nombre);
            chatList.appendChild(div);
        });
    } catch (err) {
        console.error("Error cargando chats:", err);
    }
}

// ═══════════════════════════════════════════════════════════
//  CHAT — abrir y cargar mensajes históricos
// ═══════════════════════════════════════════════════════════
async function abrirChat(id_chat, nombreChat) {
    currentChat        = id_chat;
    window.currentChat = id_chat;
    historialCoach     = [];

    document.getElementById("chatTitle").innerText = nombreChat;
    input.disabled     = false;
    input.placeholder  = "Escribe un mensaje o pide una tarea al coach...";

    // Marcar activo en sidebar
    document.querySelectorAll(".chat-item").forEach(el => el.classList.remove("active"));
    event?.currentTarget?.classList.add("active");

    socket.emit("joinChat", id_chat);
    document.dispatchEvent(new Event("chatSeleccionado"));

    // Cargar mensajes
    try {
        const res      = await fetch(`${API_URL}/api/chats/${id_chat}/messages`, { headers: authHeaders() });
        const mensajes = await res.json();
        messagesDiv.innerHTML = "";

        if (!mensajes?.length) {
            messagesDiv.innerHTML = "<p style='color:#666;font-size:13px;padding:16px'>No hay mensajes aún</p>";
        } else {
            mensajes.forEach(msg => {
                const lado = (msg.IdUsuario == usuarioId) ? "right" : "left";
                agregarBurbuja({
                    lado,
                    nombre:  msg.NombreRemitente ?? (lado === "right" ? "Tú" : "Usuario"),
                    texto:   msg.Contenido ?? msg.Mensaje ?? msg.mensaje ?? "",
                    esCoach: msg.EsCoach ?? false
                });
                historialCoach.push({
                    role:    msg.IdUsuario == usuarioId ? "user" : "assistant",
                    content: msg.Contenido ?? msg.Mensaje ?? ""
                });
            });
            messagesDiv.scrollTop = messagesDiv.scrollHeight;
        }

        cargarTareasSidebar();
    } catch (err) {
        console.error("Error cargando mensajes:", err);
    }
}

// ═══════════════════════════════════════════════════════════
//  BURBUJA — helper para agregar mensajes al DOM
// ═══════════════════════════════════════════════════════════
function agregarBurbuja({ lado, nombre, texto, esCoach = false }) {
    const div = document.createElement("div");
    div.className = "msg " + lado + (esCoach ? " coach-msg" : "");
    div.innerHTML = `
        <div class="text-bubble${esCoach ? " coach-bubble" : ""}">
            <strong>${nombre}:</strong><br>
            ${String(texto).replace(/\n/g, "<br>")}
        </div>`;
    messagesDiv.appendChild(div);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

// ═══════════════════════════════════════════════════════════
//  ENVIAR MENSAJE + COACH IA
// ═══════════════════════════════════════════════════════════
form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!currentChat) { alert("Selecciona un chat primero"); return; }

    const mensaje = input.value.trim();
    if (!mensaje) return;
    input.value = "";

    // 1. Emitir por socket (tiempo real para otros)
    socket.emit("sendMessage", { chatId: currentChat, mensaje, usuario: usuarioId });

    // 2. Persistir en BD
    await fetch(`${API_URL}/api/chats/${currentChat}/messages`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ mensaje })
    });

    // 3. Actualizar historial coach
    historialCoach.push({ role: "user", content: mensaje });

    // 4. Llamar al coach IA
    mostrarTyping();
    try {
        const coachRes  = await fetch(`${API_URL}/api/coach/message`, {
            method: "POST",
            headers: authHeaders(),
            body: JSON.stringify({ mensaje, idChat: currentChat, historial: historialCoach })
        });
        const coachData = await coachRes.json();
        quitarTyping();

        if (coachData.success) {
            agregarBurbuja({ lado: "left", nombre: "🤖 POI Coach", texto: coachData.respuesta, esCoach: true });
            historialCoach.push({ role: "assistant", content: coachData.respuesta });

            // Persistir respuesta del coach
            await fetch(`${API_URL}/api/chats/${currentChat}/messages`, {
                method: "POST",
                headers: authHeaders(),
                body: JSON.stringify({ mensaje: `🤖 Coach: ${coachData.respuesta}` })
            });

            // Tarea automática del coach
            if (coachData.tareaCreada) {
                tareasActivas.unshift(coachData.tareaCreada);
                renderTareasSidebar();
                mostrarToastTarea(coachData.tareaCreada.Descripcion);
            }
        }
    } catch (err) {
        quitarTyping();
        console.error("Error coach:", err);
    }
});

// ── Typing indicator ──────────────────────────────────────────
function mostrarTyping() {
    const div = document.createElement("div");
    div.id = "typingIndicator";
    div.className = "msg left";
    div.innerHTML = `<div class="text-bubble" style="color:#888;font-style:italic">POI Coach está escribiendo...</div>`;
    messagesDiv.appendChild(div);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}
function quitarTyping() {
    document.getElementById("typingIndicator")?.remove();
}

// ═══════════════════════════════════════════════════════════
//  TAREAS SIDEBAR
// ═══════════════════════════════════════════════════════════
async function cargarTareasSidebar() {
    try {
        const usuario = JSON.parse(localStorage.getItem("usuario"));
        const res     = await fetch(`${API_URL}/api/tareas/${usuario.id}`, { headers: authHeaders() });
        const data    = await res.json();
        tareasActivas = data.tareas ?? [];
        renderTareasSidebar();
    } catch (err) {
        console.error("Error cargando tareas sidebar:", err);
    }
}

function renderTareasSidebar() {
    const lista = document.getElementById("sidebarTaskList");
    if (!lista) return;

    if (!tareasActivas.length) {
        lista.innerHTML = `<li style="color:#666;font-size:12px;padding:6px 0">Sin tareas activas</li>`;
        return;
    }

    lista.innerHTML = "";
    tareasActivas.slice(0, 5).forEach(tarea => {
        const hecha = tarea.Estatus === true || tarea.Estatus === 1;
        const li    = document.createElement("li");
        li.style.cssText = "display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid #2a2a3e;cursor:pointer;";
        li.innerHTML = `
            <span style="font-size:13px;${hecha ? "text-decoration:line-through;color:#666" : "color:#e8eaf0"};flex:1">${tarea.Descripcion}</span>
            <span style="font-size:11px;color:#f0b429;background:rgba(240,180,41,0.1);padding:1px 6px;border-radius:10px;flex-shrink:0">+${tarea.ValorPuntos}</span>`;
        li.onclick = () => toggleTareaSidebar(tarea);
        lista.appendChild(li);
    });
}

async function toggleTareaSidebar(tarea) {
    const nuevoEstatus = !(tarea.Estatus === true || tarea.Estatus === 1);
    try {
        await fetch(`${API_URL}/api/tareas/${tarea.IdTarea}`, {
            method: "PUT",
            headers: authHeaders(),
            body: JSON.stringify({ estatus: nuevoEstatus })
        });
        tarea.Estatus = nuevoEstatus;
        renderTareasSidebar();
    } catch {
        console.error("Error actualizando tarea");
    }
}

// ── Modal nueva tarea ─────────────────────────────────────────
async function crearTareaManual() {
    const desc   = document.getElementById("nuevaTareaDesc")?.value?.trim();
    const puntos = parseInt(document.getElementById("nuevaTareaPuntos")?.value) || 10;
    const dias   = parseInt(document.getElementById("nuevaTareaDias")?.value)   || 7;
    if (!desc) { alert("Escribe una descripción para la tarea"); return; }

    try {
        const res  = await fetch(`${API_URL}/api/coach/tarea`, {
            method: "POST",
            headers: authHeaders(),
            body: JSON.stringify({ descripcion: desc, valorPuntos: puntos, diasLimite: dias, idChat: currentChat })
        });
        const data = await res.json();
        if (data.success) {
            tareasActivas.unshift(data.tarea);
            renderTareasSidebar();
            cerrarModalTarea();
            mostrarToastTarea(data.tarea.Descripcion);
        }
    } catch (err) {
        console.error("Error creando tarea:", err);
    }
}

function abrirModalTarea() {
    const m = document.getElementById("modalNuevaTarea");
    if (m) m.style.display = "flex";
}
function cerrarModalTarea() {
    const m = document.getElementById("modalNuevaTarea");
    if (!m) return;
    m.style.display = "none";
    document.getElementById("nuevaTareaDesc").value   = "";
    document.getElementById("nuevaTareaPuntos").value = "10";
    document.getElementById("nuevaTareaDias").value   = "7";
}

function mostrarToastTarea(descripcion) {
    const t = document.getElementById("toastTarea");
    if (!t) return;
    t.textContent = `✅ Nueva tarea: ${descripcion.slice(0, 40)}${descripcion.length > 40 ? "…" : ""}`;
    t.classList.add("show");
    setTimeout(() => t.classList.remove("show"), 3500);
}

// 🚀 Init
cargarChats();