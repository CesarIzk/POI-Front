// ─── videocall.js ─────────────────────────────────────────────
// WebRTC peer-to-peer usando el socket de chat.js (window.socket)
// El modal y los botones ya están en chat.html
// ──────────────────────────────────────────────────────────────

const ICE_SERVERS = {
    iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" }
    ]
};

let localStream    = null;   // MediaStream local
let peerConnection = null;   // RTCPeerConnection activa
let micActivo      = true;
let camActiva      = true;
let esLlamante     = false;  // true = quien inició la llamada

// ── Helpers UI ────────────────────────────────────────────────

function mostrarModal(id) {
    document.getElementById(id).style.display = "flex";
}
function ocultarModal(id) {
    document.getElementById(id).style.display = "none";
}
function setStatus(msg) {
    const el = document.getElementById("videoStatus");
    if (el) el.textContent = msg;
}

// ── Obtener cámara/micrófono ──────────────────────────────────

async function obtenerMediaLocal() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: true
        });
        document.getElementById("localVideo").srcObject = localStream;
        return true;
    } catch (err) {
        console.error("No se pudo acceder a cámara/micrófono:", err);
        alert("No se pudo acceder a cámara o micrófono. Revisa los permisos del navegador.");
        return false;
    }
}

// ── Crear RTCPeerConnection ───────────────────────────────────

function crearPeerConnection() {
    const pc = new RTCPeerConnection(ICE_SERVERS);

    // Agregar pistas locales
    if (localStream) {
        localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
    }

    // Recibir stream remoto
    pc.ontrack = (event) => {
        const remoteVideo = document.getElementById("remoteVideo");
        if (remoteVideo.srcObject !== event.streams[0]) {
            remoteVideo.srcObject = event.streams[0];
            setStatus("🟢 Conectado");
        }
    };

    // Enviar candidatos ICE
    pc.onicecandidate = (event) => {
        if (event.candidate) {
            window.socket.emit("iceCandidate", {
                chatId: window.currentChat ?? currentChat,
                candidate: event.candidate
            });
        }
    };

    pc.oniceconnectionstatechange = () => {
        console.log("ICE state:", pc.iceConnectionState);
        if (pc.iceConnectionState === "disconnected" ||
            pc.iceConnectionState === "failed" ||
            pc.iceConnectionState === "closed") {
            setStatus("🔴 Desconectado");
        }
    };

    return pc;
}

// ── INICIAR llamada (quien pulsa 🎥) ──────────────────────────

async function iniciarLlamada() {
    const chatId = window.currentChat ?? currentChat;
    if (!chatId) {
        alert("Abre un chat primero para iniciar una videollamada.");
        return;
    }

    esLlamante = true;
    mostrarModal("videoModal");
    setStatus("Accediendo a cámara...");

    const ok = await obtenerMediaLocal();
    if (!ok) { ocultarModal("videoModal"); return; }

    peerConnection = crearPeerConnection();
    setStatus("Llamando...");

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    window.socket.emit("videoOffer", {
        chatId,
        offer,
        from: window.usuarioId
    });
}

// ── ACEPTAR llamada entrante ──────────────────────────────────

async function aceptarLlamada() {
    ocultarModal("incomingModal");
    mostrarModal("videoModal");
    setStatus("Accediendo a cámara...");

    const ok = await obtenerMediaLocal();
    if (!ok) { ocultarModal("videoModal"); return; }

    peerConnection = crearPeerConnection();

    // Establecer el offer que llegó antes
    await peerConnection.setRemoteDescription(
        new RTCSessionDescription(window._pendingOffer.offer)
    );

    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);

    window.socket.emit("videoAnswer", {
        chatId: window._pendingOffer.chatId,
        answer,
        from: window.usuarioId
    });

    setStatus("Conectando...");
    window._pendingOffer = null;
}

// ── RECHAZAR llamada entrante ─────────────────────────────────

function rechazarLlamada() {
    ocultarModal("incomingModal");
    if (window._pendingOffer) {
        window.socket.emit("videoRejected", {
            chatId: window._pendingOffer.chatId
        });
        window._pendingOffer = null;
    }
}

// ── COLGAR ────────────────────────────────────────────────────

function colgarLlamada() {
    const chatId = window.currentChat ?? currentChat;

    window.socket.emit("videoHangup", { chatId });
    limpiarLlamada();
}

function limpiarLlamada() {
    // Detener stream local
    if (localStream) {
        localStream.getTracks().forEach(t => t.stop());
        localStream = null;
    }

    // Cerrar conexión
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }

    // Limpiar videos
    document.getElementById("localVideo").srcObject  = null;
    document.getElementById("remoteVideo").srcObject = null;

    ocultarModal("videoModal");
    setStatus("Conectando...");
    esLlamante = false;
}

// ── TOGGLE micrófono ─────────────────────────────────────────

function toggleMic() {
    if (!localStream) return;
    micActivo = !micActivo;
    localStream.getAudioTracks().forEach(t => t.enabled = micActivo);
    document.getElementById("btnToggleMic").textContent = micActivo ? "🎤" : "🔇";
    document.getElementById("btnToggleMic").style.background = micActivo ? "#444" : "#c0392b";
}

// ── TOGGLE cámara ─────────────────────────────────────────────

function toggleCam() {
    if (!localStream) return;
    camActiva = !camActiva;
    localStream.getVideoTracks().forEach(t => t.enabled = camActiva);
    document.getElementById("btnToggleCam").textContent = camActiva ? "📷" : "🚫";
    document.getElementById("btnToggleCam").style.background = camActiva ? "#444" : "#c0392b";
}

// ── EVENTOS SOCKET (señalización) ─────────────────────────────

// Alguien nos llama → guardar offer y mostrar modal entrante
window.socket.on("videoOffer", async (data) => {
    console.log("📞 videoOffer recibido", data);
    window._pendingOffer = data;
    mostrarModal("incomingModal");
});

// Recibimos answer → conectar
window.socket.on("videoAnswer", async (data) => {
    console.log("✅ videoAnswer recibido");
    if (peerConnection) {
        await peerConnection.setRemoteDescription(
            new RTCSessionDescription(data.answer)
        );
        setStatus("Conectando...");
    }
});

// ICE candidate del otro lado
window.socket.on("iceCandidate", async (data) => {
    if (peerConnection && data.candidate) {
        try {
            await peerConnection.addIceCandidate(
                new RTCIceCandidate(data.candidate)
            );
        } catch (err) {
            console.warn("ICE candidate error:", err);
        }
    }
});

// El otro colgó
window.socket.on("videoHangup", () => {
    console.log("📵 El otro colgó");
    limpiarLlamada();
});

// El otro rechazó
window.socket.on("videoRejected", () => {
    console.log("❌ Llamada rechazada");
    limpiarLlamada();
    alert("La llamada fue rechazada.");
});

// Registrar usuario en el socket para llamadas directas
if (window.usuarioId) {
    window.socket.emit("register", window.usuarioId);
}