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
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        console.log("✅ Stream obtenido:", stream.getTracks().map(t => t.kind + ":" + t.label));
        return stream;
    } catch (e) {
        console.warn("⚠ video+audio falló:", e.name, e.message);
    }

    try {
        const streamSoloVideo = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        console.log("✅ Solo video funciona");
        streamSoloVideo.getTracks().forEach(t => t.stop());
    } catch (e) {
        console.warn("⚠ solo video también falla:", e.name, e.message);
    }

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
        console.log("⚠ Fallback: solo audio");
        return stream;
    } catch (e) {
        throw new Error("Sin acceso a cámara ni micrófono: " + e.message);
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

// ─── Registrar eventos socket y DOM ────────────────────────
document.addEventListener("DOMContentLoaded", () => {
    initDOM();

    // ─── 2. RECIBIR offer ───────────────────────────────────
    window.socket.on("videoOffer", ({ chatId, offer, from }) => {
        console.log("📞 videoOffer recibido, chatId:", chatId);

        if (peerConnection) {
            getSocket().emit("videoRejected", { chatId });
            return;
        }

        pendingOffer = { offer, from, chatId };
        incomingModal.classList.add("visible");
    });

    // ─── 5. RECIBIR answer ──────────────────────────────────
    window.socket.on("videoAnswer", async ({ answer }) => {
        if (!peerConnection) return;
        await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
        videoStatus.innerText = "En llamada ✅";
    });

    // ─── 6. ICE candidates ──────────────────────────────────
    window.socket.on("iceCandidate", async ({ candidate }) => {
        if (!peerConnection || !candidate) return;
        try {
            await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (err) {
            console.error("Error ICE candidate:", err);
        }
    });

    // ─── 7. Llamada rechazada ───────────────────────────────
    window.socket.on("videoRejected", () => {
        videoStatus.innerText = "Llamada rechazada ❌";
        setTimeout(() => limpiarLlamada(), 2000);
    });

    // ─── 8. Colgar remoto ───────────────────────────────────
    window.socket.on("videoHangup", () => {
        limpiarLlamada();
    });
});

// ─── 3. ACEPTAR llamada ──────────────────────────────────────
async function aceptarLlamada() {
    incomingModal.classList.remove("visible");
    if (!pendingOffer) return;

    const { offer, chatId } = pendingOffer;
    pendingOffer = null;

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
    incomingModal.classList.remove("visible");
    if (pendingOffer) {
        getSocket().emit("videoRejected", { chatId: pendingOffer.chatId });
        pendingOffer = null;
    }
}

// ─── 9. COLGAR ───────────────────────────────────────────────
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
    if (remoteVideo && remoteVideo.srcObject) {
        remoteVideo.srcObject.getTracks().forEach(t => t.stop());
        remoteVideo.srcObject = null;
    }
    if (localVideo) localVideo.srcObject = null;

    activeChatId = null;

    if (videoModal) videoModal.classList.remove("visible");
    if (videoStatus) videoStatus.innerText = "Conectando...";

    // Limpiar botón de activar audio si existe
    const btn = document.getElementById("btnActivarAudio");
    if (btn) btn.remove();
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

    // Crear stream remoto vacío y asignarlo YA al video
    const remoteStream = new MediaStream();
    remoteVideo.srcObject = remoteStream;

    pc.ontrack = ({ track }) => {
        console.log("🎬 ontrack recibido, kind:", track.kind);
        remoteStream.addTrack(track);

        if (track.kind === "video") {
            videoStatus.innerText = "En llamada ✅";

            // Esperar canplay antes de intentar play()
            // evita "interrupted by new load request"
            remoteVideo.addEventListener("canplay", function handler() {
                remoteVideo.removeEventListener("canplay", handler);
                remoteVideo.play().then(() => {
                    remoteVideo.muted = false;
                }).catch(e => {
                    console.warn("play() falló en canplay:", e.message);
                    mostrarBotonActivarAudio();
                });
            });
        }

        if (track.kind === "audio" && !remoteStream.getVideoTracks().length) {
            videoStatus.innerText = "En llamada (solo audio) ✅";
        }
    };

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
            setTimeout(() => limpiarLlamada(), 3000);
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

function mostrarBotonActivarAudio() {
    if (document.getElementById("btnActivarAudio")) return;
    const btn = document.createElement("button");
    btn.id = "btnActivarAudio";
    btn.innerText = "▶ Activar video/audio";
    btn.style.cssText = [
        "position:fixed",
        "bottom:120px",
        "left:50%",
        "transform:translateX(-50%)",
        "z-index:1100",
        "padding:12px 28px",
        "background:#5865f2",
        "color:white",
        "border:none",
        "border-radius:10px",
        "font-size:15px",
        "cursor:pointer",
        "width:auto"
    ].join(";");
    btn.onclick = () => {
        remoteVideo.muted = false;
        remoteVideo.play().catch(e => console.warn("play manual falló:", e.message));
        btn.remove();
    };
    document.body.appendChild(btn);
}

// Liberar cámara al cerrar/recargar la página
window.addEventListener("beforeunload", () => {
    if (localStream) localStream.getTracks().forEach(t => t.stop());
});