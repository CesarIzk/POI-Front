// ─── WebRTC Video Call ──────────────────────────────────────
let peerConnection  = null;
let localStream     = null;
let micActivo       = true;
let camActiva       = true;
let pendingOffer    = null;
let activeChatId    = null;
let llamandoEnCurso = false;

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

async function obtenerIceServers() {
    try {
        const res = await fetch(`${API_URL}/api/turn-credentials`, {
            headers: { Authorization: "Bearer " + localStorage.getItem("token") }
        });
        const data = await res.json();
        
        // Si Metered devuelve error o no es array, usar fallback
        if (!Array.isArray(data.iceServers)) {
            console.warn("⚠ TURN no disponible, usando STUN:", data);
            return [{ urls: "stun:stun.l.google.com:19302" }];
        }
        
        console.log("🧊 ICE servers:", data.iceServers);
        return data.iceServers;
    } catch (e) {
        console.warn("⚠ Fallback STUN:", e.message);
        return [{ urls: "stun:stun.l.google.com:19302" }];
    }
}

function fallbackIce() {
    return [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" }
    ];
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
        const stream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
        console.log("⚠ Fallback: solo audio");
        return stream;
    } catch (e) {
        throw new Error("Sin acceso a cámara ni micrófono: " + e.message);
    }
}

// ─── 1. INICIAR llamada ──────────────────────────────────────
async function iniciarLlamada() {
    if (!currentChat)    { alert("Selecciona un chat primero"); return; }
    if (peerConnection)  { alert("Ya hay una llamada en curso"); return; }
    if (llamandoEnCurso) return;
    llamandoEnCurso = true;

    try {
        getSocket().emit("joinChat", currentChat);

        const iceServers = await obtenerIceServers();

        localStream = await obtenerStream();
        localVideo.srcObject = localStream;
        mostrarModal();
        videoStatus.innerText = localStream.getVideoTracks().length > 0
            ? "Llamando..." : "Llamando (solo audio)...";

        activeChatId   = currentChat;
        peerConnection = crearPeerConnection(activeChatId, iceServers);
        localStream.getTracks().forEach(t => peerConnection.addTrack(t, localStream));

        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);

        getSocket().emit("videoOffer", { chatId: currentChat, offer, from: usuarioId });

    } catch (err) {
        console.error("Error iniciando llamada:", err);
        alert(err.message || "No se pudo iniciar la llamada");
        limpiarLlamada();
    } finally {
        llamandoEnCurso = false;
    }
}

// ─── Registrar eventos socket y DOM ────────────────────────
document.addEventListener("DOMContentLoaded", () => {
    initDOM();

    window.socket.on("videoOffer", ({ chatId, offer, from }) => {
        console.log("📞 videoOffer recibido, chatId:", chatId);
        if (peerConnection) {
            getSocket().emit("videoRejected", { chatId });
            return;
        }
        pendingOffer = { offer, from, chatId };
        incomingModal.classList.add("visible");
    });

    window.socket.on("videoAnswer", async ({ answer }) => {
        if (!peerConnection) return;
        try {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
            videoStatus.innerText = "En llamada ✅";
        } catch (e) {
            console.error("Error setRemoteDescription (answer):", e);
        }
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
        setTimeout(() => limpiarLlamada(), 2000);
    });

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

    currentChat = chatId;
    getSocket().emit("joinChat", chatId);
    await new Promise(resolve => setTimeout(resolve, 300));

    try {
        const iceServers = await obtenerIceServers();

        localStream = await obtenerStream();
        localVideo.srcObject = localStream;
        mostrarModal();
        videoStatus.innerText = "Conectando...";

        activeChatId   = chatId;
        peerConnection = crearPeerConnection(activeChatId, iceServers);
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
    if (activeChatId) getSocket().emit("videoHangup", { chatId: activeChatId });
    limpiarLlamada();
}

function limpiarLlamada() {
    llamandoEnCurso = false;
    if (peerConnection) { peerConnection.close(); peerConnection = null; }
    if (localStream)    { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
    if (remoteVideo?.srcObject) {
        remoteVideo.srcObject.getTracks().forEach(t => t.stop());
        remoteVideo.srcObject = null;
    }
    if (localVideo) localVideo.srcObject = null;
    activeChatId = null;
    if (videoModal)  videoModal.classList.remove("visible");
    if (videoStatus) videoStatus.innerText = "Conectando...";
    document.getElementById("btnActivarAudio")?.remove();
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

// ─── Crear PeerConnection con iceServers dinámicos ────────
function crearPeerConnection(chatId, iceServers) {
    const pc = new RTCPeerConnection({ iceServers });

    pc.ontrack = ({ track, streams }) => {
        console.log("🎬 ontrack recibido, kind:", track.kind);

        if (streams?.[0]) {
            if (remoteVideo.srcObject !== streams[0]) {
                remoteVideo.srcObject = streams[0];
                console.log("✅ srcObject asignado desde streams[0]");
            }
        } else {
            if (!remoteVideo.srcObject) remoteVideo.srcObject = new MediaStream();
            remoteVideo.srcObject.addTrack(track);
        }

        const tryPlay = () => {
            remoteVideo.play().then(() => {
                remoteVideo.muted = false;
            }).catch(e => {
                if (e.name === "AbortError") {
                    setTimeout(tryPlay, 200);
                } else {
                    console.warn("⚠ play() bloqueado:", e.message);
                    mostrarBotonActivarAudio();
                }
            });
        };
        tryPlay();

        if (track.kind === "video") videoStatus.innerText = "En llamada ✅";
    };

    pc.onicecandidate = ({ candidate }) => {
        if (candidate && chatId) getSocket().emit("iceCandidate", { chatId, candidate });
    };

    pc.onconnectionstatechange = () => {
        console.log("🔗 WebRTC state:", pc.connectionState);
        if (pc.connectionState === "connected") videoStatus.innerText = "En llamada ✅";
        if (pc.connectionState === "disconnected" || pc.connectionState === "failed") {
            videoStatus.innerText = "Conexión perdida ❌";
            setTimeout(() => limpiarLlamada(), 3000);
        }
    };

    pc.onicegatheringstatechange = () => console.log("🧊 ICE gathering:", pc.iceGatheringState);
    pc.onsignalingstatechange    = () => console.log("📡 Signaling state:", pc.signalingState);

    return pc;
}

function mostrarModal() { videoModal.classList.add("visible"); }

function mostrarBotonActivarAudio() {
    if (document.getElementById("btnActivarAudio")) return;
    const btn = document.createElement("button");
    btn.id = "btnActivarAudio";
    btn.innerText = "▶ Activar video/audio";
    btn.style.cssText = [
        "position:fixed", "bottom:120px", "left:50%",
        "transform:translateX(-50%)", "z-index:1100",
        "padding:12px 28px", "background:#5865f2",
        "color:white", "border:none", "border-radius:10px",
        "font-size:15px", "cursor:pointer"
    ].join(";");
    btn.onclick = () => {
        remoteVideo.muted = false;
        remoteVideo.play().catch(e => console.warn("play manual falló:", e.message));
        btn.remove();
    };
    document.body.appendChild(btn);
}

window.addEventListener("beforeunload", () => {
    if (localStream) localStream.getTracks().forEach(t => t.stop());
});