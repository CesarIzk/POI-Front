// 🔧 Cambia esta URL por la de tu backend en Railway
const API_URL = "https://overbitterly-convuluted-katharina.ngrok-free.app";

const socket = io(API_URL);

const chatList = document.getElementById("chatList");
const messagesDiv = document.getElementById("messages");
const form = document.getElementById("chatForm");
const input = document.getElementById("mensajeInput");

let currentChat = null;

// usuarioId viene de chat.html (leído desde localStorage)
const usuarioId = window.usuarioId;

// Helper: headers con JWT para todas las peticiones autenticadas
function authHeaders() {
    const token = localStorage.getItem("token");
    return {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
    };
}


// 🔹 SOCKET: recibir mensajes en tiempo real
socket.on("receiveMessage", (data) => {
    console.log("SOCKET:", data, "ACTUAL:", currentChat);

    // Solo mostrar si es el chat activo
    if (parseInt(data.chatId) !== parseInt(currentChat)) return;

    const div = document.createElement("div");
    const lado = (data.usuario == usuarioId) ? "right" : "left";
    div.className = "msg " + lado;

    div.innerHTML = `
        <div class="text-bubble">
            <strong>${data.usuario == usuarioId ? "Tú" : "Usuario"}:</strong><br>
            ${data.mensaje}
        </div>
    `;

    messagesDiv.appendChild(div);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
});


// 🔹 Cargar lista de chats
async function cargarChats() {
    try {
        const res = await fetch(`${API_URL}/api/chats`, {
            headers: authHeaders()
        });
        const chats = await res.json();

        chatList.innerHTML = "";

        if (!chats || chats.length === 0) {
            chatList.innerHTML = "<p>No tienes chats aún</p>";
            return;
        }

        chats.forEach(chat => {
            const div = document.createElement("div");
            div.className = "chat-item";
            div.innerText = chat.NombreChatVisual;
            div.onclick = () => abrirChat(chat.IdChat, chat.NombreChatVisual);
            chatList.appendChild(div);
        });

    } catch (error) {
        console.error("Error cargando chats:", error);
    }
}


// 🔹 Abrir chat y cargar mensajes
async function abrirChat(id_chat, nombreChat) {
    currentChat = id_chat;
    console.log("Chat activo:", currentChat);

    document.getElementById("chatTitle").innerText = nombreChat;

    // Unirse al room del socket
    socket.emit("joinChat", id_chat);

    try {
        const res = await fetch(`${API_URL}/api/chats/${id_chat}/messages`, {
            headers: authHeaders()
        });
        const mensajes = await res.json();

        messagesDiv.innerHTML = "";

        if (!mensajes || mensajes.length === 0) {
            messagesDiv.innerHTML = "<p>No hay mensajes</p>";
            return;
        }

        mensajes.forEach(msg => {
            const div = document.createElement("div");
            const lado = (msg.IdUsuario == usuarioId) ? "right" : "left";
            div.className = "msg " + lado;

            div.innerHTML = `
                <div class="text-bubble">
                    <strong>${msg.NombreRemitente}:</strong><br>
                    ${msg.Contenido}
                </div>
            `;

            messagesDiv.appendChild(div);
        });

        messagesDiv.scrollTop = messagesDiv.scrollHeight;

    } catch (error) {
        console.error("Error cargando mensajes:", error);
    }
}


// 🔹 Enviar mensaje
form.addEventListener("submit", async (e) => {
    e.preventDefault();

    if (!currentChat) {
        alert("Selecciona un chat primero");
        return;
    }

    const mensaje = input.value.trim();
    if (mensaje === "") return;

    // 1. Tiempo real por socket
    socket.emit("sendMessage", {
        chatId: currentChat,
        mensaje: mensaje,
        usuario: usuarioId
    });

    // 2. Persistir en BD a través del backend
    await fetch(`${API_URL}/api/chats/${currentChat}/messages`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ mensaje })
    });

    input.value = "";
});


// 🚀 Inicializar
cargarChats();
