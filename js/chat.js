// 🔧 URL del backend en Railway
const API_URL = "https://poi-back-production-7931.up.railway.app";

const socket = io(API_URL);
window.socket = socket;

// Registrar usuario y activar videollamada cuando el socket conecte
socket.on("connect", () => {
    console.log("🔌 Socket conectado:", socket.id);
    socket.emit("register", usuarioId);      // ← notifica al servidor quién eres
    inicializarSocketVideollamada(socket);   // ← activa eventos de videollamada
});

const chatList    = document.getElementById("chatList");
const messagesDiv = document.getElementById("messages");
const form        = document.getElementById("chatForm");
const input       = document.getElementById("mensajeInput");

let currentChat = null;
let historialCoach = [];      // historial para contexto del coach
let tareasActivas  = [];      // lista local de tareas del sidebar

const usuarioId = window.usuarioId;

function authHeaders() {
    const token = localStorage.getItem("token");
    return {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
    };
}

// ═══════════════════════════════════════════════════════════
//  SOCKET — recibir mensajes en tiempo real
// ═══════════════════════════════════════════════════════════
socket.on("receiveMessage", (data) => {
    if (parseInt(data.chatId) !== parseInt(currentChat)) return;

    const div  = document.createElement("div");
    const lado = (data.usuario == usuarioId) ? "right" : "left";
    div.className = "msg " + lado;
    div.innerHTML = `
        <div class="text-bubble">
            <strong>${data.usuario == usuarioId ? "Tú" : data.nombreRemitente || "Usuario"}:</strong><br>
            ${data.mensaje}
        </div>`;
    messagesDiv.appendChild(div);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
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
            const div = document.createElement("div");
            div.className = "chat-item";
            div.innerText  = chat.NombreChatVisual;
            div.onclick    = () => abrirChat(chat.IdChat, chat.NombreChatVisual);
            chatList.appendChild(div);
        });
    } catch (err) {
        console.error("Error cargando chats:", err);
    }
}

// ═══════════════════════════════════════════════════════════
//  CHAT — abrir y cargar mensajes
// ═══════════════════════════════════════════════════════════
async function abrirChat(id_chat, nombreChat) {
    currentChat    = id_chat;
    historialCoach = [];
    document.getElementById("chatTitle").innerText = nombreChat;
    socket.emit("joinChat", id_chat);
    document.dispatchEvent(new Event("chatSeleccionado"));

    try {
        const res      = await fetch(`${API_URL}/api/chats/${id_chat}/messages`, { headers: authHeaders() });
        const mensajes = await res.json();
        messagesDiv.innerHTML = "";

        if (!mensajes?.length) {
            messagesDiv.innerHTML = "<p style='color:#666;font-size:13px;padding:16px'>No hay mensajes aún</p>";
        } else {
            mensajes.forEach(msg => {
                const div  = document.createElement("div");
                const lado = (msg.IdUsuario == usuarioId) ? "right" : "left";
                div.className = "msg " + lado;
                div.innerHTML = `
                    <div class="text-bubble">
                        <strong>${msg.NombreRemitente}:</strong><br>
                        ${msg.Contenido}
                    </div>`;
                messagesDiv.appendChild(div);

                // Reconstruir historial para el coach
                historialCoach.push({
                    role: msg.IdUsuario == usuarioId ? "user" : "assistant",
                    content: msg.Contenido
                });
            });
            messagesDiv.scrollTop = messagesDiv.scrollHeight;
        }

        // Cargar tareas del chat en el sidebar
        cargarTareasSidebar();

    } catch (err) {
        console.error("Error cargando mensajes:", err);
    }
}

// ═══════════════════════════════════════════════════════════
//  ENVIAR MENSAJE — con respuesta del coach IA
// ═══════════════════════════════════════════════════════════
form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!currentChat) { alert("Selecciona un chat primero"); return; }

    const mensaje = input.value.trim();
    if (!mensaje) return;
    input.value = "";

    // 1. Emitir por socket (tiempo real)
    socket.emit("sendMessage", { chatId: currentChat, mensaje, usuario: usuarioId });

    // 2. Persistir en BD
    await fetch(`${API_URL}/api/chats/${currentChat}/messages`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ mensaje })
    });

    // 3. Actualizar historial local
    historialCoach.push({ role: "user", content: mensaje });

    // 4. Llamar al coach IA
    mostrarTyping();
    try {
        const coachRes = await fetch(`${API_URL}/api/coach/message`, {
            method: "POST",
            headers: authHeaders(),
            body: JSON.stringify({
                mensaje,
                idChat: currentChat,
                historial: historialCoach
            })
        });
        const coachData = await coachRes.json();
        quitarTyping();

        if (coachData.success) {
            // Mostrar respuesta del coach en el chat
            agregarMensajeCoach(coachData.respuesta);
            historialCoach.push({ role: "assistant", content: coachData.respuesta });

            // Persistir respuesta del coach en BD
            await fetch(`${API_URL}/api/chats/${currentChat}/messages`, {
                method: "POST",
                headers: authHeaders(),
                body: JSON.stringify({ mensaje: `🤖 Coach: ${coachData.respuesta}` })
            });

            // Si se creó una tarea automáticamente, agregarla al sidebar
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

// ═══════════════════════════════════════════════════════════
//  COACH — UI helpers
// ═══════════════════════════════════════════════════════════
function agregarMensajeCoach(texto) {
    const div = document.createElement("div");
    div.className = "msg left coach-msg";
    div.innerHTML = `
        <div class="text-bubble coach-bubble">
            <strong>🤖 POI Coach:</strong><br>
            ${texto.replace(/\n/g, "<br>")}
        </div>`;
    messagesDiv.appendChild(div);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function mostrarTyping() {
    const div  = document.createElement("div");
    div.id     = "typingIndicator";
    div.className = "msg left";
    div.innerHTML = `<div class="text-bubble" style="color:#888;font-style:italic">POI Coach está escribiendo...</div>`;
    messagesDiv.appendChild(div);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function quitarTyping() {
    document.getElementById("typingIndicator")?.remove();
}

function mostrarToastTarea(descripcion) {
    const t = document.getElementById("toastTarea");
    if (!t) return;
    t.textContent = `✅ Nueva tarea: ${descripcion.slice(0, 40)}${descripcion.length > 40 ? "…" : ""}`;
    t.classList.add("show");
    setTimeout(() => t.classList.remove("show"), 3500);
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
            <span style="font-size:11px;color:#f0b429;background:rgba(240,180,41,0.1);padding:1px 6px;border-radius:10px;flex-shrink:0">+${tarea.ValorPuntos}</span>
        `;
        li.onclick = () => toggleTareaSidebar(tarea, li);
        lista.appendChild(li);
    });
}

async function toggleTareaSidebar(tarea, el) {
    const nuevoEstatus = !(tarea.Estatus === true || tarea.Estatus === 1);
    try {
        const res = await fetch(`${API_URL}/api/tareas/${tarea.IdTarea}`, {
            method: "PUT",
            headers: authHeaders(),
            body: JSON.stringify({ estatus: nuevoEstatus })
        });
        if (!res.ok) throw new Error();
        tarea.Estatus = nuevoEstatus;
        renderTareasSidebar();
    } catch {
        console.error("Error actualizando tarea");
    }
}

// ─── Crear tarea manual desde el modal del sidebar ──────────
async function crearTareaManual() {
    const desc  = document.getElementById("nuevaTareaDesc")?.value?.trim();
    const puntos = parseInt(document.getElementById("nuevaTareaPuntos")?.value) || 10;
    const dias   = parseInt(document.getElementById("nuevaTareaDias")?.value)   || 7;

    if (!desc) {
        alert("Escribe una descripción para la tarea");
        return;
    }

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
    document.getElementById("modalNuevaTarea")?.style && (document.getElementById("modalNuevaTarea").style.display = "flex");
}

function cerrarModalTarea() {
    const m = document.getElementById("modalNuevaTarea");
    if (m) {
        m.style.display = "none";
        document.getElementById("nuevaTareaDesc").value   = "";
        document.getElementById("nuevaTareaPuntos").value = "10";
        document.getElementById("nuevaTareaDias").value   = "7";
    }
}

// 🚀 Init
cargarChats();