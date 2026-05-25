// ─── WebRTC Video Call ──────────────────────────────────────
// STUN (descubrir IP pública) + TURN públicos (relay entre redes distintas)
const STUN_SERVERS = {
    iceServers: [
        // STUN de Google
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
        // TURN público de Open Relay (gratuito, sin registro)
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
            urls: "turns:openrelay.metered.ca:443",
            username: "openrelayproject",
            credential: "openrelayproject"
        }
    ]
};

let peerConnection  = null;
let localStream     = null;
let micActivo       = true;
let camActiva       = true;
let pendingOffer    = null;
let activeChatId    = null;

let pendingCandidates = [];

// ─── Helpers de modal (usan style directo, no classList) ───
function mostrarVideoModal()    { document.getElementById("videoModal").style.display    = "flex"; }
function ocultarVideoModal()    { document.getElementById("videoModal").style.display    = "none"; }
function mostrarIncomingModal() { document.getElementById("incomingModal").style.display = "block"; }
function ocultarIncomingModal() { document.getElementById("incomingModal").style.display = "none"; }

// ─── Helper: obtener stream con fallback ───────────────────
async function obtenerStream() {
    try {
        const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        console.log("✅ Stream video+audio");
        return s;
    } catch (e) {
        console.warn("⚠ video falló, intentando solo audio:", e.message);
    }
    try {
        const s = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
        console.log("⚠ Stream solo audio");
        return s;
    } catch (e) {
        throw new Error("Sin acceso a cámara ni micrófono: " + e.message);
    }
}

// ─── Registrar eventos socket ─────────────────────────────
// Se llama desde chat.js después de crear el socket
let _videollamadaInicializada = false;

function inicializarSocketVideollamada(socket) {
    // Evitar registrar eventos duplicados si el socket reconecta
    if (_videollamadaInicializada) {
        console.log("⚠ Videollamada ya inicializada, omitiendo re-registro");
        return;
    }
    _videollamadaInicializada = true;
    console.log("📡 Registrando eventos de videollamada en socket:", socket.id);

    socket.on("videoOffer", ({ chatId, offer, from }) => {
        console.log("📞 videoOffer recibido de", from, "chat:", chatId);

        // Si ya hay llamada en curso, rechazar automáticamente
        if (peerConnection) {
            socket.emit("videoRejected", { chatId });
            return;
        }
        pendingOffer = { offer, from, chatId };
        mostrarIncomingModal();
    });

    socket.on("videoAnswer", async ({ answer }) => {
        console.log("✅ videoAnswer recibido, estado:", peerConnection?.signalingState);
        if (!peerConnection) return;
        // Solo procesar si estamos esperando una respuesta (have-local-offer)
        if (peerConnection.signalingState !== "have-local-offer") {
            console.warn("⚠ videoAnswer ignorado, estado incorrecto:", peerConnection.signalingState);
            return;
        }
        try {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
            for (const candidate of pendingCandidates) {
    try {
        await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (e) {
        console.error("Error candidate pendiente:", e);
    }
}
pendingCandidates = [];
            document.getElementById("videoStatus").innerText = "En llamada ✅";
        } catch (e) {
            console.error("Error setRemoteDescription:", e);
        }
    });

socket.on("iceCandidate", async ({ candidate }) => {
    if (!peerConnection || !candidate) return;

    try {
        // Esperar remoteDescription
        if (!peerConnection.remoteDescription) {
            console.log("🧊 Guardando ICE candidate pendiente");
            pendingCandidates.push(candidate);
            return;
        }

        await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        console.log("✅ ICE agregado");
    } catch (e) {
        console.error("Error ICE candidate:", e);
    }
});
    socket.on("videoRejected", () => {
        document.getElementById("videoStatus").innerText = "Llamada rechazada ❌";
        setTimeout(() => limpiarLlamada(), 2000);
    });

    socket.on("videoHangup", () => {
        console.log("📵 Llamada colgada por el otro");
        limpiarLlamada();
    });
}

// ─── 1. INICIAR llamada ───────────────────────────────────
async function iniciarLlamada() {
    if (!currentChat)   { alert("Selecciona un chat primero"); return; }
    if (peerConnection) { alert("Ya hay una llamada en curso"); return; }

    try {
        // Asegurarse de estar en el room antes de emitir
        window.socket.emit("joinChat", currentChat);
        await new Promise(r => setTimeout(r, 200));

        localStream = await obtenerStream();
        document.getElementById("localVideo").srcObject = localStream;
        mostrarVideoModal();
        document.getElementById("videoStatus").innerText =
            localStream.getVideoTracks().length > 0 ? "Llamando..." : "Llamando (solo audio)...";

        activeChatId   = currentChat;
        peerConnection = crearPeerConnection(activeChatId);
        localStream.getTracks().forEach(t => peerConnection.addTrack(t, localStream));

        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);

        console.log("📤 Enviando videoOffer al chat:", activeChatId);
        // Obtener el id del otro usuario del chat para notificarle aunque no esté en el room
        const miembros = await fetch(`${API_URL}/api/chats/${activeChatId}/members`, { headers: authHeaders() }).then(r=>r.json()).catch(()=>[]);
        const destino = miembros.find(m => m.IdUsuario != usuarioId);
        window.socket.emit("videoOffer", { chatId: activeChatId, offer, from: usuarioId, toUsuarioId: destino?.IdUsuario });

    } catch (err) {
        console.error("Error iniciando llamada:", err);
        alert(err.message || "No se pudo iniciar la llamada");
        limpiarLlamada();
    }
}

// ─── 3. ACEPTAR llamada ───────────────────────────────────
async function aceptarLlamada() {
    ocultarIncomingModal();
    if (!pendingOffer) return;

    const { offer, chatId } = pendingOffer;
    pendingOffer = null;

    // Cambiar al chat de la llamada
    currentChat  = chatId;
    activeChatId = chatId;
    window.socket.emit("joinChat", chatId);
    document.getElementById("chatTitle").innerText = "Chat #" + chatId;
    await new Promise(r => setTimeout(r, 300));

    try {
        localStream = await obtenerStream();
        document.getElementById("localVideo").srcObject = localStream;
        mostrarVideoModal();
        document.getElementById("videoStatus").innerText = "Conectando...";

        peerConnection = crearPeerConnection(activeChatId);
        localStream.getTracks().forEach(t => peerConnection.addTrack(t, localStream));

        await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
for (const candidate of pendingCandidates) {
    try {
        await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (e) {
        console.error("Error candidate pendiente:", e);
    }
}
pendingCandidates = [];
        console.log("📤 Enviando videoAnswer al chat:", chatId);
        window.socket.emit("videoAnswer", { chatId, answer, from: usuarioId });

    } catch (err) {
        console.error("Error aceptando llamada:", err);
        alert(err.message || "No se pudo conectar la llamada");
        limpiarLlamada();
    }
}

// ─── 4. RECHAZAR llamada ──────────────────────────────────
function rechazarLlamada() {
    ocultarIncomingModal();
    if (pendingOffer) {
        window.socket.emit("videoRejected", { chatId: pendingOffer.chatId });
        pendingOffer = null;
    }
}

// ─── 8. COLGAR ────────────────────────────────────────────
function colgarLlamada() {
    if (activeChatId) window.socket.emit("videoHangup", { chatId: activeChatId });
    limpiarLlamada();
}

function limpiarLlamada() {
    if (peerConnection) { peerConnection.close(); peerConnection = null; }
    if (localStream)    { localStream.getTracks().forEach(t => t.stop()); localStream = null; }

    const rv = document.getElementById("remoteVideo");
    const lv = document.getElementById("localVideo");
    if (rv) rv.srcObject = null;
    if (lv) lv.srcObject = null;

    activeChatId = null;
    ocultarVideoModal();
    const vs = document.getElementById("videoStatus");
    if (vs) vs.innerText = "Conectando...";
}

// ─── Toggle mic / cam ─────────────────────────────────────
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

// ─── Crear PeerConnection ─────────────────────────────────
function crearPeerConnection(chatId) {
    const pc = new RTCPeerConnection(STUN_SERVERS);

    pc.onicecandidate = ({ candidate }) => {
        if (candidate) {
            window.socket.emit("iceCandidate", { chatId, candidate });
        }
    };

    pc.ontrack = ({ track, streams }) => {
        console.log("🎬 ontrack:", track.kind);
        const rv = document.getElementById("remoteVideo");

        if (streams?.[0]) {
            rv.srcObject = streams[0];
        } else {
            if (!rv.srcObject) rv.srcObject = new MediaStream();
            rv.srcObject.addTrack(track);
        }

        // Esperar a que el srcObject esté listo antes de reproducir
        rv.onloadedmetadata = () => {
            rv.play().catch(e => {
                console.warn("autoplay bloqueado:", e.message);
                if (!document.getElementById("btnPlay")) {
                    const btn = document.createElement("button");
                    btn.id = "btnPlay";
                    btn.innerText = "▶ Tap para ver video";
                    btn.style.cssText = "position:fixed;bottom:130px;left:50%;transform:translateX(-50%);z-index:1100;padding:12px 24px;background:#5865f2;color:white;border:none;border-radius:10px;font-size:15px;cursor:pointer;width:auto;min-height:unset;";
                    btn.onclick = () => { rv.play(); btn.remove(); };
                    document.body.appendChild(btn);
                }
            });
        };

        if (track.kind === "video") {
            document.getElementById("videoStatus").innerText = "En llamada ✅";
        }
    };

    pc.onconnectionstatechange = () => {
        console.log("🔗 WebRTC:", pc.connectionState);
        if (pc.connectionState === "connected") {
            document.getElementById("videoStatus").innerText = "En llamada ✅";
        }
        if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
            document.getElementById("videoStatus").innerText = "Conexión perdida ❌";
            setTimeout(() => limpiarLlamada(), 3000);
        }
    };

    pc.onicegatheringstatechange = () => console.log("🧊 ICE:", pc.iceGatheringState);

    return pc;
}

window.addEventListener("beforeunload", () => {
    if (localStream) localStream.getTracks().forEach(t => t.stop());
});