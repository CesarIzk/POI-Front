// ─── WebRTC Video Call ──────────────────────────────────────
const ICE_SERVERS = {
    iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
        // TURN para NAT simétrico (necesario en producción)
        {
            urls: "turn:openrelay.metered.ca:80",
            username: "openrelayproject",
            credential: "openrelayproject"
        },
        {
            urls: "turn:openrelay.metered.ca:443",
            username: "openrelayproject",
            credential: "openrelayproject"
        },
        {
            urls: "turn:openrelay.metered.ca:443?transport=tcp",
            username: "openrelayproject",
            credential: "openrelayproject"
        }
    ]
};

let peerConnection = null;
let localStream    = null;
let micActivo      = true;
let camActiva      = true;
let pendingOffer   = null;
let activeChatId   = null;

const getSocket = () => window.socket;

// ─── Elementos del DOM ─────────────────────────────────────
let videoModal, incomingModal, localVideo, remoteVideo, videoStatus;

function initDOM() {
    videoModal    = document.getElementById("videoModal");
    incomingModal = document.getElementById("incomingModal");
    localVideo    = document.getElementById("localVideo");
    remoteVideo   = document.getElementById("remoteVideo");
    videoStatus   = document.getElementById("videoStatus");
}

// ─── Helper: obtener stream con fallback ───────────────────
async function obtenerStream() {
    try {
        return await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    } catch (e) {
        console.warn("Cámara no disponible, intentando solo audio:", e.message);
    }
    try {
        return await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
    } catch (e) {
        console.error("Sin acceso a micrófono tampoco:", e.message);
        throw new Error("No se pudo acceder a cámara ni micrófono. Verifica que no estén en uso por otra app.");
    }
}

// ─── 1. INICIAR llamada ──────────────────────────────────────
async function iniciarLlamada() {
    if (!currentChat) {
        alert("Selecciona un chat primero");
        return;
    }

    if (peerConnection) {
        alert("Ya hay una llamada en curso");
        return;
    }

    try {
        // FIX: asegurar que el socket esté en la sala antes de emitir el offer
        getSocket().emit("joinChat", currentChat);

        localStream = await obtenerStream();
        localVideo.srcObject = localStream;
        mostrarModal();
        videoStatus.innerText = localStream.getVideoTracks().length > 0
            ? "Llamando..." : "Llamando (solo audio)...";

        activeChatId = currentChat;
        peerConnection = crearPeerConnection(activeChatId);
        localStream.getTracks().forEach(t => peerConnection.addTrack(t, localStream));

        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);

        getSocket().emit("videoOffer", { chatId: currentChat, offer, from: usuarioId });

    } catch (err) {
        console.error("Error iniciando llamada:", err);
        alert(err.message || "No se pudo iniciar la llamada");
        limpiarLlamada();
    }
}

// ─── 2. RECIBIR offer ────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
    initDOM();

    window.socket.on("videoOffer", ({ chatId, offer, from }) => {
        console.log("📞 videoOffer recibido, chatId:", chatId);

        if (peerConnection) {
            getSocket().emit("videoRejected", { chatId });
            return;
        }

        // FIX: unirse a la sala al recibir el offer, no al aceptar
        getSocket().emit("joinChat", chatId);

        pendingOffer = { offer, from, chatId };

        incomingModal.setAttribute("style", "display:block !important");
        incomingModal.style.setProperty("display", "block", "important");
        incomingModal.style.visibility = "visible";
        incomingModal.style.opacity    = "1";
        incomingModal.style.zIndex     = "9999";
    });

    window.socket.on("videoAnswer", async ({ answer }) => {
        if (!peerConnection) return;
        console.log("✅ videoAnswer recibido");
        await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
        videoStatus.innerText = "En llamada ✅";
    });

    window.socket.on("iceCandidate", async ({ candidate }) => {
        if (!peerConnection || !candidate) return;
        try {
            await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (err) {
            console.error("Error ICE candidate:", err);
        }
    });

    window.socket.on("videoRejected", () => {
        videoStatus.innerText = "Llamada rechazada ❌";
        setTimeout(() => colgarLlamada(), 2000);
    });

    window.socket.on("videoHangup", () => {
        colgarLlamada();
    });
});

// ─── 3. ACEPTAR llamada ──────────────────────────────────────
async function aceptarLlamada() {
    incomingModal.style.setProperty("display", "none", "important");
    incomingModal.style.display = "none";

    if (!pendingOffer) return;
    const { offer, chatId } = pendingOffer;
    pendingOffer = null;

    // Ya hicimos joinChat al recibir el offer, pero si el currentChat
    // es diferente actualizamos la UI igual
    if (parseInt(chatId) !== parseInt(currentChat)) {
        currentChat = chatId;
        document.getElementById("chatTitle").innerText = "Chat #" + chatId;
    }

    try {
        localStream = await obtenerStream();
        localVideo.srcObject = localStream;
        mostrarModal();
        videoStatus.innerText = "Conectando...";

        activeChatId = chatId;
        peerConnection = crearPeerConnection(activeChatId);
        localStream.getTracks().forEach(t => peerConnection.addTrack(t, localStream));

        await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);

        getSocket().emit("videoAnswer", { chatId, answer, from: usuarioId });

    } catch (err) {
        console.error("Error al aceptar llamada:", err);
        alert(err.message || "No se pudo conectar la llamada");
        limpiarLlamada();
    }
}

// ─── 4. RECHAZAR llamada ─────────────────────────────────────
function rechazarLlamada() {
    incomingModal.style.setProperty("display", "none", "important");
    incomingModal.style.display = "none";

    if (pendingOffer) {
        getSocket().emit("videoRejected", { chatId: pendingOffer.chatId });
        pendingOffer = null;
    }
}

// ─── 5. COLGAR ───────────────────────────────────────────────
function colgarLlamada() {
    if (activeChatId) {
        getSocket().emit("videoHangup", { chatId: activeChatId });
    }
    limpiarLlamada();
}

function limpiarLlamada() {
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
    activeChatId = null;

    videoModal.style.setProperty("display", "none", "important");
    videoModal.style.display = "none";
    videoStatus.innerText = "Conectando...";
}

// ─── Toggle mic / cam ────────────────────────────────────────
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

// ─── Helpers ─────────────────────────────────────────────────
function crearPeerConnection(chatId) {
    const pc = new RTCPeerConnection(ICE_SERVERS);

    pc.onicecandidate = ({ candidate }) => {
        if (candidate && chatId) {
            getSocket().emit("iceCandidate", { chatId, candidate });
        }
    };

    // FIX: log para confirmar que el track remoto llega
    pc.ontrack = ({ streams }) => {
        console.log("🎥 ontrack disparado, streams:", streams.length);
        remoteVideo.srcObject = streams[0];
        videoStatus.innerText = "En llamada ✅";
    };

    pc.onconnectionstatechange = () => {
        console.log("Estado conexión WebRTC:", pc.connectionState);
        if (pc.connectionState === "disconnected" || pc.connectionState === "failed") {
            videoStatus.innerText = "Conexión perdida ❌";
        }
    };

    // FIX: log de ICE para diagnosticar si TURN está funcionando
    pc.oniceconnectionstatechange = () => {
        console.log("ICE state:", pc.iceConnectionState);
    };

    return pc;
}

function mostrarModal() {
    videoModal.style.setProperty("display", "flex", "important");
    videoModal.style.visibility = "visible";
    videoModal.style.opacity    = "1";
    videoModal.style.zIndex     = "9999";
}