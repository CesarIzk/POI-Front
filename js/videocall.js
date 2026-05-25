// ─── WebRTC Video Call ──────────────────────────────────────
// TURN públicos gratuitos — múltiples opciones por si alguno falla
const ICE_CONFIG = {
    iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
        // Cloudflare TURN (muy confiable)
        {
            urls: "turn:turn.cloudflare.com:3478?transport=udp",
            username: "g0c73b765ce3e5f4c02d3e7a2b1f8d9a",
            credential: "ZJGXuL7mNqP2RtVs"
        },
        // Metered Open Relay (backup)
        {
            urls: [
                "turn:openrelay.metered.ca:80",
                "turn:openrelay.metered.ca:443",
                "turns:openrelay.metered.ca:443"
            ],
            username: "openrelayproject",
            credential: "openrelayproject"
        }
    ],
    iceCandidatePoolSize: 10
};

let peerConnection   = null;
let localStream      = null;
let micActivo        = true;
let camActiva        = true;
let pendingOffer     = null;
let activeChatId     = null;
let pendingCandidates = [];
let _videollamadaInicializada = false;

// ─── Modales ───────────────────────────────────────────────
function mostrarVideoModal()    { document.getElementById("videoModal").style.display    = "flex"; }
function ocultarVideoModal()    { document.getElementById("videoModal").style.display    = "none"; }
function mostrarIncomingModal() { document.getElementById("incomingModal").style.display = "block"; }
function ocultarIncomingModal() { document.getElementById("incomingModal").style.display = "none"; }

// ─── Stream con fallback ───────────────────────────────────
async function obtenerStream() {
    try {
        const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        console.log("✅ Stream video+audio");
        return s;
    } catch (e) {
        console.warn("⚠ Solo audio:", e.message);
    }
    try {
        return await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
    } catch (e) {
        throw new Error("Sin acceso a cámara ni micrófono: " + e.message);
    }
}

// ─── Registrar eventos socket ─────────────────────────────
function inicializarSocketVideollamada(socket) {
    if (_videollamadaInicializada) {
        console.log("⚠ Videollamada ya inicializada");
        return;
    }
    _videollamadaInicializada = true;
    console.log("📡 Registrando eventos de videollamada en socket:", socket.id);

    socket.on("videoOffer", ({ chatId, offer, from }) => {
        console.log("📞 videoOffer de", from, "chat:", chatId);
        if (peerConnection) {
            socket.emit("videoRejected", { chatId });
            return;
        }
        pendingOffer = { offer, from, chatId };
        mostrarIncomingModal();
    });

    socket.on("videoAnswer", async ({ answer }) => {
        console.log("✅ videoAnswer, estado:", peerConnection?.signalingState);
        if (!peerConnection) return;
        if (peerConnection.signalingState !== "have-local-offer") {
            console.warn("⚠ videoAnswer ignorado, estado:", peerConnection.signalingState);
            return;
        }
        try {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
            // Aplicar candidatos que llegaron antes del answer
            await aplicarCandidatesPendientes();
        } catch (e) {
            console.error("Error setRemoteDescription answer:", e);
        }
    });

    socket.on("iceCandidate", async ({ candidate }) => {
        if (!candidate) return;
        if (!peerConnection || !peerConnection.remoteDescription) {
            pendingCandidates.push(candidate);
            console.log("🧊 ICE guardado, total:", pendingCandidates.length);
            return;
        }
        try {
            await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (e) {
            console.error("Error ICE:", e.message);
        }
    });

    socket.on("videoRejected", () => {
        document.getElementById("videoStatus").innerText = "Llamada rechazada ❌";
        setTimeout(limpiarLlamada, 2000);
    });

    socket.on("videoHangup", () => {
        console.log("📵 Llamada colgada por el otro");
        limpiarLlamada();
    });
}

async function aplicarCandidatesPendientes() {
    if (!peerConnection || !peerConnection.remoteDescription) return;
    console.log("🧊 Aplicando", pendingCandidates.length, "candidatos pendientes");
    for (const c of pendingCandidates) {
        try {
            await peerConnection.addIceCandidate(new RTCIceCandidate(c));
        } catch (e) {
            console.error("Error candidate pendiente:", e.message);
        }
    }
    pendingCandidates = [];
}

// ─── 1. INICIAR llamada ───────────────────────────────────
async function iniciarLlamada() {
    if (!currentChat)   { alert("Selecciona un chat primero"); return; }
    if (peerConnection) { alert("Ya hay una llamada en curso"); return; }

    try {
        window.socket.emit("joinChat", currentChat);
        await new Promise(r => setTimeout(r, 300));

        localStream = await obtenerStream();
        document.getElementById("localVideo").srcObject = localStream;
        mostrarVideoModal();
        document.getElementById("videoStatus").innerText =
            localStream.getVideoTracks().length > 0 ? "Llamando..." : "Llamando (solo audio)...";

        activeChatId   = currentChat;
        pendingCandidates = [];
        peerConnection = crearPeerConnection(activeChatId);
        localStream.getTracks().forEach(t => peerConnection.addTrack(t, localStream));

        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);

        // Buscar destinatario para notificarle directamente
        const miembros = await fetch(`${API_URL}/api/chats/${activeChatId}/members`, {
            headers: authHeaders()
        }).then(r => r.json()).catch(() => []);
        const destino = miembros.find(m => m.IdUsuario != usuarioId);

        console.log("📤 videoOffer → chat:", activeChatId, "destino:", destino?.IdUsuario);
        window.socket.emit("videoOffer", {
            chatId: activeChatId,
            offer,
            from: usuarioId,
            toUsuarioId: destino?.IdUsuario
        });

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

        pendingCandidates = [];
        peerConnection = crearPeerConnection(activeChatId);
        localStream.getTracks().forEach(t => peerConnection.addTrack(t, localStream));

        // Orden correcto: setRemote → createAnswer → setLocal → aplicar ICE pendientes → emit answer
        await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
        await aplicarCandidatesPendientes();

        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);

        console.log("📤 videoAnswer → chat:", chatId);
        window.socket.emit("videoAnswer", { chatId, answer, from: usuarioId });

    } catch (err) {
        console.error("Error aceptando llamada:", err);
        alert(err.message || "No se pudo conectar");
        limpiarLlamada();
    }
}

// ─── 4. RECHAZAR ─────────────────────────────────────────
function rechazarLlamada() {
    ocultarIncomingModal();
    if (pendingOffer) {
        window.socket.emit("videoRejected", { chatId: pendingOffer.chatId });
        pendingOffer = null;
    }
}

// ─── 8. COLGAR ───────────────────────────────────────────
function colgarLlamada() {
    if (activeChatId) window.socket.emit("videoHangup", { chatId: activeChatId });
    limpiarLlamada();
}

function limpiarLlamada() {
    pendingCandidates = [];
    if (peerConnection) { peerConnection.close(); peerConnection = null; }
    if (localStream)    { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
    const rv = document.getElementById("remoteVideo");
    const lv = document.getElementById("localVideo");
    if (rv) rv.srcObject = null;
    if (lv) lv.srcObject = null;
    document.getElementById("btnPlay")?.remove();
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

// ─── PeerConnection ──────────────────────────────────────
function crearPeerConnection(chatId) {
    const pc = new RTCPeerConnection(ICE_CONFIG);

    pc.onicecandidate = ({ candidate }) => {
        if (candidate) {
            window.socket.emit("iceCandidate", { chatId, candidate });
        } else {
            console.log("🧊 ICE gathering completo");
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
        rv.onloadedmetadata = () => {
            rv.play().catch(e => {
                console.warn("autoplay bloqueado:", e.message);
                if (!document.getElementById("btnPlay")) {
                    const btn = document.createElement("button");
                    btn.id = "btnPlay";
                    btn.innerText = "▶ Tap para activar video";
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
        if (pc.connectionState === "failed") {
            document.getElementById("videoStatus").innerText = "Conexión perdida ❌";
            setTimeout(limpiarLlamada, 3000);
        }
    };

    pc.onicegatheringstatechange = () => console.log("🧊 ICE gathering:", pc.iceGatheringState);
    pc.onsignalingstatechange    = () => console.log("📡 Signaling:", pc.signalingState);

    return pc;
}

window.addEventListener("beforeunload", () => {
    if (localStream) localStream.getTracks().forEach(t => t.stop());
});