// ─────────────────────────────────────────────────────────────
// videocall.js
// WebRTC + Socket.IO
// ─────────────────────────────────────────────────────────────

const ICE_SERVERS = {
    iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" }
    ]
};

let localStream = null;
let peerConnection = null;

let micActivo = true;
let camActiva = true;

let pendingOffer = null;
let pendingCandidates = [];


// ─────────────────────────────────────────────────────────────
// HELPERS UI
// ─────────────────────────────────────────────────────────────

function mostrarModal(id) {
    document.getElementById(id).style.display = "flex";
}

function ocultarModal(id) {
    document.getElementById(id).style.display = "none";
}

function setStatus(texto) {
    const el = document.getElementById("videoStatus");
    if (el) el.innerText = texto;
}


// ─────────────────────────────────────────────────────────────
// MEDIA LOCAL
// ─────────────────────────────────────────────────────────────

async function obtenerMediaLocal() {

    try {

        localStream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: true
        });

        document.getElementById("localVideo").srcObject = localStream;

        return true;

    } catch (err) {

        console.error("Error media:", err);

        alert("No se pudo acceder a cámara o micrófono");

        return false;
    }
}


// ─────────────────────────────────────────────────────────────
// PEER CONNECTION
// ─────────────────────────────────────────────────────────────

function crearPeerConnection(chatId) {

    const pc = new RTCPeerConnection(ICE_SERVERS);

    // tracks locales
    if (localStream) {

        localStream.getTracks().forEach(track => {
            pc.addTrack(track, localStream);
        });
    }

    // stream remoto
    pc.ontrack = (event) => {

        console.log("🎬 TRACK REMOTO");

        const remoteVideo = document.getElementById("remoteVideo");

        if (event.streams && event.streams[0]) {

            remoteVideo.srcObject = event.streams[0];

        } else {

            if (!remoteVideo.srcObject) {
                remoteVideo.srcObject = new MediaStream();
            }

            remoteVideo.srcObject.addTrack(event.track);
        }

        remoteVideo.autoplay = true;
remoteVideo.playsInline = true;
remoteVideo.muted = false;

remoteVideo.play().catch(err => {
    console.warn("Autoplay bloqueado:", err);
});

        setStatus("En llamada ✅");
    };

    // ICE local
    pc.onicecandidate = (event) => {

        if (event.candidate) {

            console.log("📤 ICE enviado");

            window.socket.emit("iceCandidate", {
                chatId,
                candidate: event.candidate
            });
        }
    };

    // estado
    pc.onconnectionstatechange = () => {

        console.log("🔗 STATE:", pc.connectionState);

        if (pc.connectionState === "connected") {
            setStatus("En llamada ✅");
        }

        if (
            pc.connectionState === "failed" ||
            pc.connectionState === "disconnected" ||
            pc.connectionState === "closed"
        ) {

            setStatus("Conexión perdida ❌");

            setTimeout(() => {
                limpiarLlamada();
            }, 2000);
        }
    };

    return pc;
}


// ─────────────────────────────────────────────────────────────
// INICIAR LLAMADA
// ─────────────────────────────────────────────────────────────

async function iniciarLlamada() {

    const chatId = window.currentChat ?? currentChat;

    if (!chatId) {
        alert("Selecciona un chat");
        return;
    }

    mostrarModal("videoModal");

    setStatus("Accediendo a cámara...");

    const ok = await obtenerMediaLocal();

    if (!ok) {
        ocultarModal("videoModal");
        return;
    }

    pendingCandidates = [];

    peerConnection = crearPeerConnection(chatId);

    setStatus("Llamando...");

    const offer = await peerConnection.createOffer();

    await peerConnection.setLocalDescription(offer);

    window.socket.emit("videoOffer", {
        chatId,
        offer,
        from: window.usuarioId
    });
}


// ─────────────────────────────────────────────────────────────
// ACEPTAR LLAMADA
// ─────────────────────────────────────────────────────────────

async function aceptarLlamada() {

    if (!pendingOffer) return;

    ocultarModal("incomingModal");

    mostrarModal("videoModal");

    setStatus("Accediendo a cámara...");

    const ok = await obtenerMediaLocal();

    if (!ok) return;

    const { offer, chatId } = pendingOffer;


    peerConnection = crearPeerConnection(chatId);

    await peerConnection.setRemoteDescription(
        new RTCSessionDescription(offer)
    );

    // agregar ICE pendientes
    for (const candidate of pendingCandidates) {

        try {

            await peerConnection.addIceCandidate(
                new RTCIceCandidate(candidate)
            );

        } catch (err) {

            console.error("Error ICE pendiente:", err);
        }
    }

    pendingCandidates = [];

    const answer = await peerConnection.createAnswer();

    await peerConnection.setLocalDescription(answer);

    window.socket.emit("videoAnswer", {
        chatId,
        answer,
        from: window.usuarioId
    });

    pendingOffer = null;

    setStatus("Conectando...");
}


// ─────────────────────────────────────────────────────────────
// RECHAZAR
// ─────────────────────────────────────────────────────────────

function rechazarLlamada() {

    ocultarModal("incomingModal");

    if (pendingOffer) {

        window.socket.emit("videoRejected", {
            chatId: pendingOffer.chatId
        });
    }

    pendingOffer = null;
}


// ─────────────────────────────────────────────────────────────
// COLGAR
// ─────────────────────────────────────────────────────────────

function colgarLlamada() {

    const chatId = window.currentChat ?? currentChat;

    window.socket.emit("videoHangup", { chatId });

    limpiarLlamada();
}


// ─────────────────────────────────────────────────────────────
// LIMPIAR
// ─────────────────────────────────────────────────────────────

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

    document.getElementById("localVideo").srcObject = null;
    document.getElementById("remoteVideo").srcObject = null;

    ocultarModal("videoModal");

    setStatus("Conectando...");
}


// ─────────────────────────────────────────────────────────────
// TOGGLES
// ─────────────────────────────────────────────────────────────

function toggleMic() {

    if (!localStream) return;

    micActivo = !micActivo;

    localStream.getAudioTracks().forEach(track => {
        track.enabled = micActivo;
    });
}

function toggleCam() {

    if (!localStream) return;

    camActiva = !camActiva;

    localStream.getVideoTracks().forEach(track => {
        track.enabled = camActiva;
    });
}


// ─────────────────────────────────────────────────────────────
// SOCKET EVENTS
// ─────────────────────────────────────────────────────────────

// evitar listeners duplicados
window.socket.off("videoOffer");
window.socket.off("videoAnswer");
window.socket.off("iceCandidate");
window.socket.off("videoHangup");
window.socket.off("videoRejected");


// OFFER
window.socket.on("videoOffer", async (data) => {

    console.log("📞 videoOffer recibido");

    pendingOffer = data;

    mostrarModal("incomingModal");
});


// ANSWER
window.socket.on("videoAnswer", async (data) => {

    console.log("✅ videoAnswer recibido");

    if (!peerConnection) return;

    try {

        await peerConnection.setRemoteDescription(
            new RTCSessionDescription(data.answer)
        );

        // agregar ICE pendientes
        for (const candidate of pendingCandidates) {

            try {

                await peerConnection.addIceCandidate(
                    new RTCIceCandidate(candidate)
                );

            } catch (err) {

                console.error(err);
            }
        }

        pendingCandidates = [];

    } catch (err) {

        console.error("Error answer:", err);
    }
});


// ICE
window.socket.on("iceCandidate", async (data) => {

    if (!peerConnection || !data.candidate) return;

    try {

        // TODAVÍA NO HAY REMOTE DESCRIPTION
        if (!peerConnection.remoteDescription) {

            console.log("🧊 ICE pendiente guardado");

            pendingCandidates.push(data.candidate);

            return;
        }

        await peerConnection.addIceCandidate(
            new RTCIceCandidate(data.candidate)
        );

        console.log("✅ ICE agregado");

    } catch (err) {

        console.error("ICE candidate error:", err);
    }
});


// HANGUP
window.socket.on("videoHangup", () => {

    console.log("📵 Llamada terminada");

    limpiarLlamada();
});


// REJECT
window.socket.on("videoRejected", () => {

    console.log("❌ Llamada rechazada");

    limpiarLlamada();

    alert("La llamada fue rechazada.");
});


// REGISTER
if (window.usuarioId) {

    window.socket.emit("register", window.usuarioId);
}


// cleanup navegador
window.addEventListener("beforeunload", () => {

    if (localStream) {

        localStream.getTracks().forEach(track => {
            track.stop();
        });
    }
});