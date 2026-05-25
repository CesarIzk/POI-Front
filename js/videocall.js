// ─── WebRTC Video Call ──────────────────────────────────────
// Usa el socket ya conectado en chat.js (window.socket)
const ICE_SERVERS = {
    iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" }
    ]
};

let peerConnection = null;
let localStream    = null;
let micActivo      = true;
let camActiva      = true;
let pendingOffer   = null;

// Usar siempre window.socket para evitar problemas de scope en móvil
const getSocket = () => window.socket;

// ─── Elementos del DOM ─────────────────────────────────────
const videoModal    = document.getElementById("videoModal");
const incomingModal = document.getElementById("incomingModal");
const localVideo    = document.getElementById("localVideo");
const remoteVideo   = document.getElementById("remoteVideo");
const videoStatus   = document.getElementById("videoStatus");


// ─── Helper: obtener stream con fallback ───────────────────
async function obtenerStream() {
    // Intentar video + audio
    try {
        return await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    } catch (e) {
        console.warn("Cámara no disponible, intentando solo audio:", e.message);
    }
    // Fallback: solo audio
    try {
        return await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
    } catch (e) {
        console.error("Sin acceso a micrófono tampoco:", e.message);
        throw new Error("No se pudo acceder a cámara ni micrófono. Verifica que no estén en uso por otra app.");
    }
}


// ─── 1. INICIAR llamada (quien llama) ──────────────────────
async function iniciarLlamada() {
    if (!currentChat) {
        alert("Selecciona un chat primero");
        return;
    }

    try {
        localStream = await obtenerStream();
        localVideo.srcObject = localStream;
        mostrarModal();
        videoStatus.innerText = localStream.getVideoTracks().length > 0
            ? "Llamando..." : "Llamando (solo audio)...";

        peerConnection = crearPeerConnection();
        localStream.getTracks().forEach(t => peerConnection.addTrack(t, localStream));

        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);

        getSocket().emit("videoOffer", { chatId: currentChat, offer, from: usuarioId });

    } catch (err) {
        console.error("Error iniciando llamada:", err);
        alert(err.message || "No se pudo iniciar la llamada");
    }
}


// ─── 2. RECIBIR offer (quien recibe la llamada) ─────────────
// ⚠️ NO filtramos por currentChat aquí — la llamada puede llegar
//    aunque el receptor tenga otro chat abierto o ninguno
window.socket.on("videoOffer", async ({ chatId, offer, from }) => {
    console.log("📞 videoOffer recibido, chatId:", chatId, "currentChat:", currentChat);
    pendingOffer = { offer, from, chatId };
    incomingModal.style.display = "block";
});


// ─── 3. ACEPTAR llamada ─────────────────────────────────────
async function aceptarLlamada() {
    incomingModal.style.display = "none";
    if (!pendingOffer) return;
    const { offer, chatId } = pendingOffer;

    // Si el usuario no estaba en ese chat, abrirlo automáticamente
    if (parseInt(chatId) !== parseInt(currentChat)) {
        currentChat = chatId;
        getSocket().emit("joinChat", chatId);
        document.getElementById("chatTitle").innerText = "Chat #" + chatId;
    }

    try {
        localStream = await obtenerStream();
        localVideo.srcObject = localStream;
        mostrarModal();
        videoStatus.innerText = "Conectando...";

        peerConnection = crearPeerConnection();
        localStream.getTracks().forEach(t => peerConnection.addTrack(t, localStream));

        await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);

        getSocket().emit("videoAnswer", { chatId, answer, from: usuarioId });

    } catch (err) {
        console.error("Error al aceptar llamada:", err);
        alert(err.message || "No se pudo conectar la llamada");
    }
}


// ─── 4. RECHAZAR llamada ────────────────────────────────────
function rechazarLlamada() {
    incomingModal.style.display = "none";
    if (pendingOffer) {
        getSocket().emit("videoRejected", { chatId: pendingOffer.chatId });
    }
    pendingOffer = null;
}


// ─── 5. RECIBIR answer ──────────────────────────────────────
window.socket.on("videoAnswer", async ({ answer }) => {
    if (!peerConnection) return;
    await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
    videoStatus.innerText = "En llamada ✅";
});


// ─── 6. ICE candidates ──────────────────────────────────────
window.socket.on("iceCandidate", async ({ candidate }) => {
    if (!peerConnection || !candidate) return;
    try {
        await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
        console.error("Error ICE candidate:", err);
    }
});


// ─── 7. Llamada rechazada ───────────────────────────────────
window.socket.on("videoRejected", () => {
    videoStatus.innerText = "Llamada rechazada ❌";
    setTimeout(() => colgarLlamada(), 2000);
});


// ─── 8. COLGAR ──────────────────────────────────────────────
function colgarLlamada() {
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    if (localStream) {
        localStream.getTracks().forEach(t => t.stop());
        localStream = null;
    }

    localVideo.srcObject  = null;
    remoteVideo.srcObject = null;
    videoModal.style.display = "none";
    videoStatus.innerText = "Conectando...";

    if (currentChat) {
        getSocket().emit("videoHangup", { chatId: currentChat });
    }
}

window.socket.on("videoHangup", () => {
    colgarLlamada();
});


// ─── 9. Toggle mic / cam ────────────────────────────────────
function toggleMic() {
    if (!localStream) return;
    micActivo = !micActivo;
    localStream.getAudioTracks().forEach(t => t.enabled = micActivo);
    document.getElementById("btnToggleMic").style.background = micActivo ? "#444" : "#e74c3c";
}

function toggleCam() {
    if (!localStream) return;
    camActiva = !camActiva;
    localStream.getVideoTracks().forEach(t => t.enabled = camActiva);
    document.getElementById("btnToggleCam").style.background = camActiva ? "#444" : "#e74c3c";
}


// ─── Helpers ────────────────────────────────────────────────
function crearPeerConnection() {
    const pc = new RTCPeerConnection(ICE_SERVERS);

    pc.onicecandidate = ({ candidate }) => {
        if (candidate && currentChat) {
            getSocket().emit("iceCandidate", { chatId: currentChat, candidate });
        }
    };

    pc.ontrack = ({ streams }) => {
        remoteVideo.srcObject = streams[0];
        videoStatus.innerText = "En llamada ✅";
    };

    pc.onconnectionstatechange = () => {
        console.log("Estado conexión WebRTC:", pc.connectionState);
        if (pc.connectionState === "disconnected" || pc.connectionState === "failed") {
            videoStatus.innerText = "Conexión perdida ❌";
        }
    };

    return pc;
}

function mostrarModal() {
    videoModal.style.display = "flex";
}