// ─── WebRTC Video Call ──────────────────────────────────────
// Usa el socket ya conectado en chat.js (window.socket)
// STUN servers gratuitos de Google para atravesar NAT
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
let pendingOffer   = null; // guarda el offer mientras se acepta

// ─── Elementos del DOM ─────────────────────────────────────
const videoModal    = document.getElementById("videoModal");
const incomingModal = document.getElementById("incomingModal");
const localVideo    = document.getElementById("localVideo");
const remoteVideo   = document.getElementById("remoteVideo");
const videoStatus   = document.getElementById("videoStatus");


// ─── 1. INICIAR llamada (quien llama) ──────────────────────
async function iniciarLlamada() {
    if (!currentChat) {
        alert("Selecciona un chat primero");
        return;
    }

    // Intentar con video+audio; si la cámara está ocupada, fallback a solo audio
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    } catch (videoErr) {
        console.warn("Cámara no disponible, intentando solo audio:", videoErr.message);
        try {
            localStream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
        } catch (audioErr) {
            alert("No se pudo acceder a la cámara ni al micrófono.\nCierra otras apps que la estén usando.");
            return;
        }
    }

    try {
        localVideo.srcObject = localStream;
        mostrarModal();
        videoStatus.innerText = localStream.getVideoTracks().length > 0 ? "Llamando..." : "Llamando (solo audio)...";

        peerConnection = crearPeerConnection();
        localStream.getTracks().forEach(t => peerConnection.addTrack(t, localStream));

        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);

        socket.emit("videoOffer", { chatId: currentChat, offer, from: usuarioId });

    } catch (err) {
        console.error("Error iniciando llamada:", err);
        alert("Error al iniciar la llamada: " + err.message);
    }
}


// ─── 2. RECIBIR offer (quien recibe la llamada) ─────────────
socket.on("videoOffer", async ({ chatId, offer, from }) => {
    if (parseInt(chatId) !== parseInt(currentChat)) return;

    pendingOffer = { offer, from, chatId };
    incomingModal.style.display = "block";
});


// ─── 3. ACEPTAR llamada ─────────────────────────────────────
async function aceptarLlamada() {
    incomingModal.style.display = "none";

    if (!pendingOffer) return;
    const { offer, chatId } = pendingOffer;

    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        localVideo.srcObject = localStream;

        mostrarModal();
        videoStatus.innerText = "Conectando...";

        peerConnection = crearPeerConnection();
        localStream.getTracks().forEach(t => peerConnection.addTrack(t, localStream));

        await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);

        socket.emit("videoAnswer", { chatId, answer, from: usuarioId });

    } catch (err) {
        console.error("Error al aceptar llamada:", err);
    }
}


// ─── 4. RECHAZAR llamada ────────────────────────────────────
function rechazarLlamada() {
    incomingModal.style.display = "none";
    if (pendingOffer) {
        socket.emit("videoRejected", { chatId: pendingOffer.chatId });
    }
    pendingOffer = null;
}


// ─── 5. RECIBIR answer ──────────────────────────────────────
socket.on("videoAnswer", async ({ answer }) => {
    if (!peerConnection) return;
    await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
    videoStatus.innerText = "En llamada ✅";
});


// ─── 6. ICE candidates ──────────────────────────────────────
socket.on("iceCandidate", async ({ candidate }) => {
    if (!peerConnection || !candidate) return;
    try {
        await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
        console.error("Error ICE candidate:", err);
    }
});


// ─── 7. Llamada rechazada ───────────────────────────────────
socket.on("videoRejected", () => {
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
        socket.emit("videoHangup", { chatId: currentChat });
    }
}

socket.on("videoHangup", () => {
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

    // Enviar ICE candidates al otro peer
    pc.onicecandidate = ({ candidate }) => {
        if (candidate && currentChat) {
            socket.emit("iceCandidate", { chatId: currentChat, candidate });
        }
    };

    // Cuando llega el stream remoto, mostrarlo
    pc.ontrack = ({ streams }) => {
        remoteVideo.srcObject = streams[0];
        videoStatus.innerText = "En llamada ✅";
    };

    pc.onconnectionstatechange = () => {
        if (pc.connectionState === "disconnected" || pc.connectionState === "failed") {
            videoStatus.innerText = "Conexión perdida ❌";
        }
    };

    return pc;
}

function mostrarModal() {
    videoModal.style.display = "flex";
}