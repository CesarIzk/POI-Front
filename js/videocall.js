// ─── WebRTC Video Call ──────────────────────────────────────

const STUN_SERVERS = {
    iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" }
    ]
};

let peerConnection  = null;
let localStream     = null;
let micActivo       = true;
let camActiva       = true;
let pendingOffer    = null;
let activeChatId    = null;
let pendingCandidates = [];

// ─── Helpers de modal ──────────────────────────────────────

function mostrarVideoModal() {
    document.getElementById("videoModal").style.display = "flex";
}

function ocultarVideoModal() {
    document.getElementById("videoModal").style.display = "none";
}

function mostrarIncomingModal() {
    document.getElementById("incomingModal").style.display = "block";
}

function ocultarIncomingModal() {
    document.getElementById("incomingModal").style.display = "none";
}

// ─── Obtener stream ────────────────────────────────────────

async function obtenerStream() {

    try {
        const s = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: true
        });

        console.log("✅ Stream video+audio");
        return s;

    } catch (e) {

        console.warn("⚠ video falló, intentando solo audio:", e.message);

        try {

            const s = await navigator.mediaDevices.getUserMedia({
                video: false,
                audio: true
            });

            console.log("⚠ Stream solo audio");
            return s;

        } catch (err) {

            throw new Error(
                "Sin acceso a cámara ni micrófono: " + err.message
            );
        }
    }
}

// ─── Socket events ─────────────────────────────────────────

function inicializarSocketVideollamada(socket) {

    // limpiar listeners viejos
    socket.off("videoOffer");
    socket.off("videoAnswer");
    socket.off("iceCandidate");
    socket.off("videoRejected");
    socket.off("videoHangup");

    console.log("📡 Registrando eventos de videollamada en socket:", socket.id);

    // ── OFFER ──────────────────────────────────────────────

    socket.on("videoOffer", ({ chatId, offer, from }) => {

        console.log("📞 videoOffer recibido de", from, "chat:", chatId);

        if (peerConnection) {
            socket.emit("videoRejected", { chatId });
            return;
        }

        pendingOffer = { offer, from, chatId };

        mostrarIncomingModal();
    });

    // ── ANSWER ─────────────────────────────────────────────

    socket.on("videoAnswer", async ({ answer }) => {

        console.log(
            "✅ videoAnswer recibido, estado:",
            peerConnection?.signalingState
        );

        if (!peerConnection) return;

        if (peerConnection.signalingState !== "have-local-offer") {
            console.warn(
                "⚠ videoAnswer ignorado, estado incorrecto:",
                peerConnection.signalingState
            );
            return;
        }

        try {

            await peerConnection.setRemoteDescription(
                new RTCSessionDescription(answer)
            );

            // agregar ICE pendientes
            for (const candidate of pendingCandidates) {

                try {

                    await peerConnection.addIceCandidate(
                        new RTCIceCandidate(candidate)
                    );

                    console.log("✅ ICE pendiente agregado");

                } catch (e) {

                    console.error(
                        "Error agregando candidate pendiente:",
                        e
                    );
                }
            }

            pendingCandidates = [];

            document.getElementById("videoStatus").innerText =
                "En llamada ✅";

        } catch (e) {

            console.error("Error setRemoteDescription:", e);
        }
    });

    // ── ICE ────────────────────────────────────────────────

    socket.on("iceCandidate", async ({ candidate }) => {

        if (!peerConnection || !candidate) return;

        console.log("📥 ICE recibido:", candidate.type);

        try {

            // esperar remoteDescription
            if (!peerConnection.remoteDescription) {

                console.log("🧊 Guardando ICE pendiente");

                pendingCandidates.push(candidate);

                return;
            }

            await peerConnection.addIceCandidate(
                new RTCIceCandidate(candidate)
            );

            console.log("✅ ICE agregado");

        } catch (e) {

            console.error("❌ Error ICE candidate:", e);
        }
    });

    // ── REJECT ─────────────────────────────────────────────

    socket.on("videoRejected", () => {

        document.getElementById("videoStatus").innerText =
            "Llamada rechazada ❌";

        setTimeout(() => {
            limpiarLlamada();
        }, 2000);
    });

    // ── HANGUP ─────────────────────────────────────────────

    socket.on("videoHangup", () => {

        console.log("📵 Llamada colgada por el otro");

        limpiarLlamada();
    });
}

// ─── INICIAR LLAMADA ───────────────────────────────────────

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

        window.socket.emit("joinChat", currentChat);

        await new Promise(r => setTimeout(r, 200));

        localStream = await obtenerStream();

        document.getElementById("localVideo").srcObject =
            localStream;

        mostrarVideoModal();

        document.getElementById("videoStatus").innerText =
            "Llamando...";

        activeChatId = currentChat;

        pendingCandidates = [];

        peerConnection = crearPeerConnection(activeChatId);

        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
        });

        const offer = await peerConnection.createOffer();

        await peerConnection.setLocalDescription(offer);

        console.log("📤 Enviando videoOffer");

        const miembros = await fetch(
            `${API_URL}/api/chats/${activeChatId}/members`,
            {
                headers: authHeaders()
            }
        )
        .then(r => r.json())
        .catch(() => []);

        const destino = miembros.find(
            m => m.IdUsuario != usuarioId
        );

        window.socket.emit("videoOffer", {
            chatId: activeChatId,
            offer,
            from: usuarioId,
            toUsuarioId: destino?.IdUsuario
        });

    } catch (err) {

        console.error("❌ Error iniciando llamada:", err);

        alert(err.message || "No se pudo iniciar la llamada");

        limpiarLlamada();
    }
}

// ─── ACEPTAR LLAMADA ───────────────────────────────────────

async function aceptarLlamada() {

    ocultarIncomingModal();

    if (!pendingOffer) return;

    const { offer, chatId } = pendingOffer;

    pendingOffer = null;

    currentChat  = chatId;
    activeChatId = chatId;

    window.socket.emit("joinChat", chatId);

    document.getElementById("chatTitle").innerText =
        "Chat #" + chatId;

    await new Promise(r => setTimeout(r, 300));

    try {

        localStream = await obtenerStream();

        document.getElementById("localVideo").srcObject =
            localStream;

        mostrarVideoModal();

        document.getElementById("videoStatus").innerText =
            "Conectando...";

        pendingCandidates = [];

        peerConnection = crearPeerConnection(activeChatId);

        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
        });

        await peerConnection.setRemoteDescription(
            new RTCSessionDescription(offer)
        );

        // agregar ICE pendientes
        for (const candidate of pendingCandidates) {

            try {

                await peerConnection.addIceCandidate(
                    new RTCIceCandidate(candidate)
                );

                console.log("✅ ICE pendiente agregado");

            } catch (e) {

                console.error(
                    "Error agregando ICE pendiente:",
                    e
                );
            }
        }

        pendingCandidates = [];

        const answer = await peerConnection.createAnswer();

        await peerConnection.setLocalDescription(answer);

        console.log("📤 Enviando videoAnswer");

        window.socket.emit("videoAnswer", {
            chatId,
            answer,
            from: usuarioId
        });

    } catch (err) {

        console.error("❌ Error aceptando llamada:", err);

        alert(err.message || "No se pudo conectar");

        limpiarLlamada();
    }
}

// ─── RECHAZAR ──────────────────────────────────────────────

function rechazarLlamada() {

    ocultarIncomingModal();

    if (pendingOffer) {

        window.socket.emit("videoRejected", {
            chatId: pendingOffer.chatId
        });

        pendingOffer = null;
    }
}

// ─── COLGAR ────────────────────────────────────────────────

function colgarLlamada() {

    if (activeChatId) {

        window.socket.emit("videoHangup", {
            chatId: activeChatId
        });
    }

    limpiarLlamada();
}

// ─── LIMPIAR ───────────────────────────────────────────────

function limpiarLlamada() {

    if (peerConnection) {

        peerConnection.close();

        peerConnection = null;
    }

    if (localStream) {

        localStream.getTracks().forEach(track => {
            track.stop();
        });

        localStream = null;
    }

    pendingCandidates = [];

    const rv = document.getElementById("remoteVideo");
    const lv = document.getElementById("localVideo");

    if (rv) rv.srcObject = null;
    if (lv) lv.srcObject = null;

    activeChatId = null;

    ocultarVideoModal();

    const vs = document.getElementById("videoStatus");

    if (vs) {
        vs.innerText = "Conectando...";
    }
}

// ─── TOGGLE MIC ────────────────────────────────────────────

function toggleMic() {

    if (!localStream) return;

    micActivo = !micActivo;

    localStream.getAudioTracks().forEach(track => {
        track.enabled = micActivo;
    });

    document.getElementById("btnToggleMic").style.background =
        micActivo ? "#444" : "#e74c3c";
}

// ─── TOGGLE CAM ────────────────────────────────────────────

function toggleCam() {

    if (!localStream) return;

    camActiva = !camActiva;

    localStream.getVideoTracks().forEach(track => {
        track.enabled = camActiva;
    });

    document.getElementById("btnToggleCam").style.background =
        camActiva ? "#444" : "#e74c3c";
}

// ─── CREAR PEER CONNECTION ─────────────────────────────────

function crearPeerConnection(chatId) {

    const pc = new RTCPeerConnection(STUN_SERVERS);

    // ── ICE candidate ──────────────────────────────────────

    pc.onicecandidate = ({ candidate }) => {

        console.log("📤 Enviando ICE:", candidate?.type);

        if (candidate) {

            window.socket.emit("iceCandidate", {
                chatId,
                candidate
            });
        }
    };

    // ── ICE state ──────────────────────────────────────────

    pc.oniceconnectionstatechange = () => {

        console.log(
            "🧊 ICE connection:",
            pc.iceConnectionState
        );
    };

    // ── ICE error ──────────────────────────────────────────

    pc.onicecandidateerror = (e) => {

        console.error("❌ ICE ERROR:", e);
    };

    // ── Track remoto ───────────────────────────────────────

    pc.ontrack = ({ track, streams }) => {

        console.log("🎬 ontrack:", track.kind);

        const rv = document.getElementById("remoteVideo");

        if (streams?.[0]) {

            rv.srcObject = streams[0];

        } else {

            if (!rv.srcObject) {
                rv.srcObject = new MediaStream();
            }

            rv.srcObject.addTrack(track);
        }

        rv.onloadedmetadata = () => {

            rv.play().catch(e => {

                console.warn(
                    "⚠ autoplay bloqueado:",
                    e.message
                );
            });
        };

        if (track.kind === "video") {

            document.getElementById("videoStatus").innerText =
                "En llamada ✅";
        }
    };

    // ── Connection state ───────────────────────────────────

    pc.onconnectionstatechange = () => {

        console.log("🔗 WebRTC:", pc.connectionState);

        if (pc.connectionState === "connected") {

            document.getElementById("videoStatus").innerText =
                "En llamada ✅";
        }

        if (
            pc.connectionState === "failed" ||
            pc.connectionState === "disconnected"
        ) {

            document.getElementById("videoStatus").innerText =
                "Conexión perdida ❌";

            setTimeout(() => {
                limpiarLlamada();
            }, 3000);
        }
    };

    pc.onicegatheringstatechange = () => {

        console.log("🧊 ICE gathering:", pc.iceGatheringState);
    };

    return pc;
}

// ─── BEFORE UNLOAD ─────────────────────────────────────────

window.addEventListener("beforeunload", () => {

    if (localStream) {

        localStream.getTracks().forEach(track => {
            track.stop();
        });
    }
});