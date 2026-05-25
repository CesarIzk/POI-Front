// ─── WebRTC Video Call ──────────────────────────────────────
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
let activeChatId   = null; // ← FIX Bug 3: capturar chatId al crear PC

const getSocket = () => window.socket;

// ─── Elementos del DOM ─────────────────────────────────────
// FIX Bug 1: acceder al DOM solo cuando esté listo
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

    // FIX Bug 4: evitar doble llamada
    if (peerConnection) {
        alert("Ya hay una llamada en curso");
        return;
    }

    try {
        localStream = await obtenerStream();
        localVideo.srcObject = localStream;
        mostrarModal();
        videoStatus.innerText = localStream.getVideoTracks().length > 0
            ? "Llamando..." : "Llamando (solo audio)...";

        activeChatId = currentChat; // FIX Bug 3
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
// FIX Bug 1: registrar el evento DENTRO de DOMContentLoaded
// para garantizar que el DOM exista en móvil
document.addEventListener("DOMContentLoaded", () => {
    initDOM();

    window.socket.on("videoOffer", ({ chatId, offer, from }) => {
        console.log("📞 videoOffer recibido, chatId:", chatId);

        // FIX Bug 4: si ya hay llamada activa, rechazar automáticamente
        if (peerConnection) {
            getSocket().emit("videoRejected", { chatId });
            return;
        }

        pendingOffer = { offer, from, chatId };

    incomingModal.classList.add("visible");

    });

    window.socket.on("videoAnswer", async ({ answer }) => {
        if (!peerConnection) return;
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
// FIX iOS Bug: aceptarLlamada se llama desde un tap/click del usuario,
// lo que satisface el requisito de "user gesture" de iOS para getUserMedia
async function aceptarLlamada() {
   incomingModal.classList.remove("visible");


    if (!pendingOffer) return;
    const { offer, chatId } = pendingOffer;
    pendingOffer = null; // FIX Bug 4: limpiar inmediatamente para evitar doble proceso

    if (parseInt(chatId) !== parseInt(currentChat)) {
        currentChat = chatId;
        getSocket().emit("joinChat", chatId);
        document.getElementById("chatTitle").innerText = "Chat #" + chatId;
    }

    try {
        localStream = await obtenerStream();
        localVideo.srcObject = localStream;

        // FIX Bug 2: mostrarModal con forzado de display
        mostrarModal();

        videoStatus.innerText = "Conectando...";

        activeChatId = chatId; // FIX Bug 3
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
incomingModal.classList.remove("visible");


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

    // FIX: limpiar srcObject correctamente
    if (remoteVideo.srcObject) {
        remoteVideo.srcObject.getTracks().forEach(t => t.stop());
        remoteVideo.srcObject = null;
    }
    localVideo.srcObject = null;
    activeChatId = null;

    videoModal.classList.remove("visible");
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

function crearPeerConnection(chatId) {
    const pc = new RTCPeerConnection(ICE_SERVERS);

    // ── FIX PRINCIPAL ──────────────────────────────────────────
    // Crear un MediaStream vacío y asignarlo YA al video.
    // Así el elemento siempre tiene un srcObject válido desde el inicio.
    // Cuando llegan los tracks los agregamos uno a uno — esto funciona
    // en todos los browsers incluyendo Safari iOS donde streams[] llega vacío.
    const remoteStream = new MediaStream();
    remoteVideo.srcObject = remoteStream;

    pc.ontrack = ({ track, streams }) => {
        console.log("🎬 ontrack recibido, kind:", track.kind);

        // Agregar el track al stream ya asignado
        remoteStream.addTrack(track);

        // Si el video está pausado (autoplay bloqueado), forzar play
        // Esto pasa especialmente en Chrome móvil
        remoteVideo.play().catch(err => {
            console.warn("▶ autoplay bloqueado, esperando interacción:", err.message);
        });

        videoStatus.innerText = "En llamada ✅";
    };
    // ──────────────────────────────────────────────────────────

    pc.onicecandidate = ({ candidate }) => {
        if (candidate && chatId) {
            getSocket().emit("iceCandidate", { chatId, candidate });
        }
    };

    pc.onconnectionstatechange = () => {
        console.log("🔗 WebRTC state:", pc.connectionState);
        if (pc.connectionState === "connected") {
            videoStatus.innerText = "En llamada ✅";
        }
        if (pc.connectionState === "disconnected" || pc.connectionState === "failed") {
            videoStatus.innerText = "Conexión perdida ❌";
            setTimeout(() => colgarLlamada(), 3000);
        }
    };

    pc.onicegatheringstatechange = () => {
        console.log("🧊 ICE gathering:", pc.iceGatheringState);
    };

    pc.onsignalingstatechange = () => {
        console.log("📡 Signaling state:", pc.signalingState);
    };

    return pc;
}

function mostrarModal() {
    videoModal.classList.add("visible");
}
