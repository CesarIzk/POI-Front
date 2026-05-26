
// ─────────────────────────────────────────────────────────────
// videocall.js — Videollamada por frames JPEG sobre Socket.IO
// ─────────────────────────────────────────────────────────────

let localStream   = null;
let frameInterval = null;
let enLlamada     = false;
let chatIdLlamada = null;
let pendingOffer  = null;
let micActivo     = true;
let camActiva     = true;

// Canvas oculto para capturar frames del video local
const canvas = document.createElement("canvas");
const ctx2d  = canvas.getContext("2d");
canvas.width  = 320;
canvas.height = 240;


// ── Helpers UI ────────────────────────────────────────────────
function mostrarModal(id) { document.getElementById(id).style.display = "flex"; }
function ocultarModal(id) { document.getElementById(id).style.display = "none"; }
function setStatus(txt)   { const el = document.getElementById("videoStatus"); if (el) el.innerText = txt; }


// ── Obtener cámara y micrófono ────────────────────────────────
async function obtenerMediaLocal() {
    try {
        // Timeout explícito de 10s para evitar AbortError silencioso
        const streamPromise = navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error("Timeout: la cámara tardó demasiado")), 10000)
        );
        localStream = await Promise.race([streamPromise, timeoutPromise]);
        document.getElementById("localVideo").srcObject = localStream;

        // Esperar a que el video esté realmente listo antes de continuar
        await new Promise((resolve) => {
            const v = document.getElementById("localVideo");
            if (v.readyState >= 2) { resolve(); return; }
            v.addEventListener("canplay", resolve, { once: true });
        });

        return true;
    } catch (err) {
        console.error("Media error:", err);
        const msg = err.message.includes("Timeout")
            ? "La cámara tardó demasiado en responder. Intenta de nuevo."
            : "No se pudo acceder a cámara o micrófono. Revisa los permisos.";
        alert(msg);
        return false;
    }
}


// ── Enviar frames por socket ──────────────────────────────────
function iniciarEnvioFrames(chatId) {
    const videoEl = document.getElementById("localVideo");
    frameInterval = setInterval(() => {
        if (!localStream || !enLlamada) return;
        if (videoEl.readyState < 2) return;
        ctx2d.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
        const frame = canvas.toDataURL("image/jpeg", 0.5);
        window.socket.emit("videoFrame", { chatId, frame, from: window.usuarioId });
    }, 100);
}

function detenerEnvioFrames() {
    if (frameInterval) { clearInterval(frameInterval); frameInterval = null; }
}


// ── INICIAR LLAMADA ───────────────────────────────────────────
async function iniciarLlamada() {
    const chatId = window.currentChat;
    if (!chatId) { alert("Abre un chat primero."); return; }

    mostrarModal("videoModal");
    setStatus("Accediendo a cámara...");

    const ok = await obtenerMediaLocal();
    if (!ok) { ocultarModal("videoModal"); return; }

    chatIdLlamada = chatId;
    enLlamada     = true;

    // Emitir DESPUÉS de que la cámara está lista
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
        from:   window.usuarioId
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

    const lv = document.getElementById("localVideo");
    const rv = document.getElementById("remoteVideo");
    if (lv) lv.srcObject = null;
    if (rv) { rv.srcObject = null; rv.src = ""; rv.style.display = ""; }

    document.getElementById("remoteFrameImg")?.remove();

    ocultarModal("videoModal");
    setStatus("Conectando...");
    chatIdLlamada = null;

    document.getElementById("btnToggleMic").textContent        = "🎤";
    document.getElementById("btnToggleMic").style.background   = "#444";
    document.getElementById("btnToggleCam").textContent        = "📷";
    document.getElementById("btnToggleCam").style.background   = "#444";
    micActivo = true;
    camActiva = true;
}


// ── TOGGLE mic / cam ──────────────────────────────────────────
function toggleMic() {
    if (!localStream) return;
    micActivo = !micActivo;
    localStream.getAudioTracks().forEach(t => t.enabled = micActivo);
    document.getElementById("btnToggleMic").textContent      = micActivo ? "🎤" : "🔇";
    document.getElementById("btnToggleMic").style.background = micActivo ? "#444" : "#c0392b";
}

function toggleCam() {
    if (!localStream) return;
    camActiva = !camActiva;
    localStream.getVideoTracks().forEach(t => t.enabled = camActiva);
    document.getElementById("btnToggleCam").textContent      = camActiva ? "📷" : "🚫";
    document.getElementById("btnToggleCam").style.background = camActiva ? "#444" : "#c0392b";
}


// ── SOCKET: registrar listeners (con guard para window.socket) ─
function registrarSocketVideollamada() {
    const s = window.socket;
    if (!s) { console.warn("videocall.js: window.socket no disponible"); return; }

    s.off("videoOffer");
    s.off("videoAnswer");
    s.off("videoFrame");
    s.off("videoHangup");
    s.off("videoRejected");

    // Llamada entrante
    s.on("videoOffer", (data) => {
        if (String(data.from) === String(window.usuarioId)) return;
        console.log("📞 Llamada entrante");
        pendingOffer = data;
        mostrarModal("incomingModal");
    });

    // Receptor aceptó
    s.on("videoAnswer", (data) => {
        if (String(data.from) === String(window.usuarioId)) return;
        console.log("✅ Llamada aceptada");
        setStatus("En llamada ✅");
    });

    // Frame de video remoto
    s.on("videoFrame", (data) => {
        if (String(data.from) === String(window.usuarioId)) return;
        let img = document.getElementById("remoteFrameImg");
        if (!img) {
            img = document.createElement("img");
            img.id = "remoteFrameImg";
            img.style.cssText = "width:100%; height:100%; object-fit:cover; border-radius:12px; display:block;";
            const container = document.getElementById("remoteVideo").parentElement;
            container.style.position = "relative";
            document.getElementById("remoteVideo").style.display = "none";
            container.appendChild(img);
        }
        img.src = data.frame;
    });

    // El otro colgó
    s.on("videoHangup", () => {
        console.log("📵 Llamada terminada por el otro");
        limpiarLlamada();
    });

    // Llamada rechazada
    s.on("videoRejected", () => {
        console.log("❌ Llamada rechazada");
        limpiarLlamada();
        alert("La llamada fue rechazada.");
    });
}

// Registrar cuando el socket esté listo
if (window.socket) {
    registrarSocketVideollamada();
} else {
    // Por si chat.js aún no terminó de conectar
    window.addEventListener("load", registrarSocketVideollamada);
}

// Cleanup al cerrar pestaña
window.addEventListener("beforeunload", () => {
    if (enLlamada) colgarLlamada();
    if (localStream) localStream.getTracks().forEach(t => t.stop());
});
