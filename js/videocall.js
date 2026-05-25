// ─────────────────────────────────────────────────────────────
// videocall.js — Videollamada por Socket.IO (sin WebRTC)
// Funciona en cualquier red: local, diferente red, NAT estricto
// ─────────────────────────────────────────────────────────────

let localStream    = null;
let frameInterval  = null;   // setInterval que captura y envía frames
let enLlamada      = false;
let chatIdLlamada  = null;
let pendingOffer   = null;

let micActivo = true;
let camActiva = true;

// Canvas oculto para capturar frames del video local
const canvas  = document.createElement("canvas");
const ctx2d   = canvas.getContext("2d");
canvas.width  = 320;
canvas.height = 240;


// ── Helpers UI ────────────────────────────────────────────────

function mostrarModal(id) { document.getElementById(id).style.display = "flex"; }
function ocultarModal(id) { document.getElementById(id).style.display = "none"; }
function setStatus(txt)   { const el = document.getElementById("videoStatus"); if (el) el.innerText = txt; }


// ── Obtener cámara y micrófono ────────────────────────────────

async function obtenerMediaLocal() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        document.getElementById("localVideo").srcObject = localStream;
        return true;
    } catch (err) {
        console.error("Media error:", err);
        alert("No se pudo acceder a cámara o micrófono. Revisa los permisos.");
        return false;
    }
}


// ── Capturar y enviar frames por socket ──────────────────────
// Toma un frame del video local cada ~100ms (10 fps) y lo
// manda como base64 al servidor, que lo reenvía al otro lado.

function iniciarEnvioFrames(chatId) {
    const videoEl = document.getElementById("localVideo");

    frameInterval = setInterval(() => {
        if (!localStream || !enLlamada) return;
        if (videoEl.readyState < 2) return;   // video aún no listo

        ctx2d.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
        const frame = canvas.toDataURL("image/jpeg", 0.5);   // calidad 50%

        window.socket.emit("videoFrame", { chatId, frame, from: window.usuarioId });
    }, 100);
}

function detenerEnvioFrames() {
    if (frameInterval) { clearInterval(frameInterval); frameInterval = null; }
}


// ── INICIAR LLAMADA ───────────────────────────────────────────

async function iniciarLlamada() {
    const chatId = window.currentChat ?? currentChat;
    if (!chatId) { alert("Abre un chat primero."); return; }

    mostrarModal("videoModal");
    setStatus("Accediendo a cámara...");

    const ok = await obtenerMediaLocal();
    if (!ok) { ocultarModal("videoModal"); return; }

    chatIdLlamada = chatId;
    enLlamada     = true;

    window.socket.emit("videoOffer", { chatId, from: window.usuarioId });
    setStatus("Llamando...");
    iniciarEnvioFrames(chatId);
}


// ── ACEPTAR LLAMADA ───────────────────────────────────────────

async function aceptarLlamada() {
    ocultarModal("incomingModal");
    mostrarModal("videoModal");
    setStatus("Accediendo a cámara...");

    const ok = await obtenerMediaLocal();
    if (!ok) { ocultarModal("videoModal"); return; }

    chatIdLlamada = pendingOffer.chatId;
    enLlamada     = true;

    window.socket.emit("videoAnswer", {
        chatId: pendingOffer.chatId,
        from: window.usuarioId
    });

    setStatus("En llamada ✅");
    iniciarEnvioFrames(pendingOffer.chatId);
    pendingOffer = null;
}


// ── RECHAZAR LLAMADA ──────────────────────────────────────────

function rechazarLlamada() {
    ocultarModal("incomingModal");
    if (pendingOffer) {
        window.socket.emit("videoRejected", { chatId: pendingOffer.chatId });
        pendingOffer = null;
    }
}


// ── COLGAR ────────────────────────────────────────────────────

function colgarLlamada() {
    window.socket.emit("videoHangup", { chatId: chatIdLlamada });
    limpiarLlamada();
}

function limpiarLlamada() {
    enLlamada = false;
    detenerEnvioFrames();

    if (localStream) {
        localStream.getTracks().forEach(t => t.stop());
        localStream = null;
    }

    document.getElementById("localVideo").srcObject  = null;
    document.getElementById("remoteVideo").srcObject = null;

    // Limpiar imagen del video remoto
    const rv = document.getElementById("remoteVideo");
    rv.src = "";

    ocultarModal("videoModal");
    setStatus("Conectando...");
    chatIdLlamada = null;

    // Resetear botones
    document.getElementById("btnToggleMic").textContent = "🎤";
    document.getElementById("btnToggleMic").style.background = "#444";
    document.getElementById("btnToggleCam").textContent = "📷";
    document.getElementById("btnToggleCam").style.background = "#444";
    micActivo = true;
    camActiva = true;
}


// ── TOGGLE mic / cam ──────────────────────────────────────────

function toggleMic() {
    if (!localStream) return;
    micActivo = !micActivo;
    localStream.getAudioTracks().forEach(t => t.enabled = micActivo);
    document.getElementById("btnToggleMic").textContent = micActivo ? "🎤" : "🔇";
    document.getElementById("btnToggleMic").style.background = micActivo ? "#444" : "#c0392b";
}

function toggleCam() {
    if (!localStream) return;
    camActiva = !camActiva;
    localStream.getVideoTracks().forEach(t => t.enabled = camActiva);
    document.getElementById("btnToggleCam").textContent = camActiva ? "📷" : "🚫";
    document.getElementById("btnToggleCam").style.background = camActiva ? "#444" : "#c0392b";
}


// ── SOCKET: señalización ──────────────────────────────────────

window.socket.off("videoOffer");
window.socket.off("videoAnswer");
window.socket.off("videoFrame");
window.socket.off("videoHangup");
window.socket.off("videoRejected");


// Llamada entrante
window.socket.on("videoOffer", (data) => {
    if (String(data.from) === String(window.usuarioId)) return;  // ignorar eco
    console.log("📞 Llamada entrante");
    pendingOffer = data;
    mostrarModal("incomingModal");
});

// El receptor aceptó → el llamante actualiza status
window.socket.on("videoAnswer", (data) => {
    if (String(data.from) === String(window.usuarioId)) return;
    console.log("✅ Llamada aceptada");
    setStatus("En llamada ✅");
});

// Frame de video remoto → mostrarlo en <img> dentro del remoteVideo o en un <img> dedicado
window.socket.on("videoFrame", (data) => {
    if (String(data.from) === String(window.usuarioId)) return;  // no mostrar el propio

    // Usamos un <img> superpuesto sobre el <video> remoto para mostrar los frames
    let img = document.getElementById("remoteFrameImg");
    if (!img) {
        img = document.createElement("img");
        img.id = "remoteFrameImg";
        img.style.cssText = "width:100%; height:100%; object-fit:cover; border-radius:12px; display:block;";
        const remoteContainer = document.getElementById("remoteVideo").parentElement;
        remoteContainer.style.position = "relative";
        document.getElementById("remoteVideo").style.display = "none";
        remoteContainer.appendChild(img);
    }
    img.src = data.frame;
});

// El otro colgó
window.socket.on("videoHangup", () => {
    console.log("📵 Llamada terminada por el otro");
    limpiarLlamada();
    // Remover img remota si existe
    document.getElementById("remoteFrameImg")?.remove();
    document.getElementById("remoteVideo").style.display = "";
});

// Llamada rechazada
window.socket.on("videoRejected", () => {
    console.log("❌ Llamada rechazada");
    limpiarLlamada();
    alert("La llamada fue rechazada.");
});


// Cleanup al cerrar la pestaña
window.addEventListener("beforeunload", () => {
    if (enLlamada) colgarLlamada();
    if (localStream) localStream.getTracks().forEach(t => t.stop());
});