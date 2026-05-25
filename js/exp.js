// js/exp.js — incluir en home.html y chat.html
// Maneja la EXP en tiempo real vía socket y actualiza la UI

const API_URL = "https://poi-back-production-7931.up.railway.app";

// ── Conectar al socket y unirse a sala personal ─────────────
function iniciarSocketEXP(socket, idUsuario) {
    // Unirse a la sala personal para recibir eventos de EXP
    socket.emit("joinUser", idUsuario);

    // ── Evento: EXP actualizada ──────────────────────────────
    socket.on("expActualizada", (data) => {
        /*  data = {
                PuntosActuales, IdRango, NombreRango,
                SubioRango, PuntosSiguienteRango
            }
        */
        actualizarUIexp(data);

        // Sincronizar localStorage
        const usuario = JSON.parse(localStorage.getItem("usuario")) || {};
        usuario.exp   = data.PuntosActuales;
        usuario.rango = data.NombreRango;
        localStorage.setItem("usuario", JSON.stringify(usuario));
    });

    // ── Evento: subió de rango ───────────────────────────────
    socket.on("subioDERango", (data) => {
        mostrarCelebracionRango(data.nombreRango, data.puntos);
    });
}

// ── Sumar EXP al completar una tarea ────────────────────────
async function sumarEXP(puntos) {
    const token = localStorage.getItem("token");
    try {
        const res  = await fetch(`${API_URL}/api/usuario/exp`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${token}`
            },
            body: JSON.stringify({ puntos })
        });
        const data = await res.json();
        if (data.success) {
            actualizarUIexp(data);

            const usuario = JSON.parse(localStorage.getItem("usuario")) || {};
            usuario.exp   = data.PuntosActuales;
            usuario.rango = data.NombreRango;
            localStorage.setItem("usuario", JSON.stringify(usuario));

            if (data.SubioRango) {
                mostrarCelebracionRango(data.NombreRango, data.PuntosActuales);
            }
        }
        return data;
    } catch (err) {
        console.error("[sumarEXP]", err);
    }
}

// ── Actualizar todos los elementos de EXP en la página ──────
function actualizarUIexp(data) {
    const {
        PuntosActuales,
        NombreRango,
        PuntosRangoActual = 0,
        PuntosSiguienteRango
    } = data;

    // Calcular porcentaje de progreso dentro del rango actual
    const base    = PuntosRangoActual || 0;
    const techo   = PuntosSiguienteRango || PuntosActuales;
    const rango   = techo - base || 1;
    const progreso = Math.min(100, Math.round(((PuntosActuales - base) / rango) * 100));

    // ── home.html ────────────────────────────────────────────
    const elExp      = document.getElementById("expUsuario");
    const elExpTotal = document.getElementById("expTotal");
    const elRank     = document.getElementById("rankUsuario");
    const elFill     = document.getElementById("progressFill");
    const elLabel    = document.getElementById("expLabel");

    if (elExp)      animarNumero(elExp,      PuntosActuales, " EXP");
    if (elExpTotal) animarNumero(elExpTotal, PuntosActuales, "");
    if (elRank)     elRank.textContent = NombreRango?.toUpperCase() || "";
    if (elFill)     elFill.style.width = progreso + "%";
    if (elLabel)    elLabel.textContent =
        `${PuntosActuales} / ${PuntosSiguienteRango ?? "MAX"} EXP — ${progreso}% al siguiente rango`;

    // ── chat.html sidebar ────────────────────────────────────
    const elNivelSidebar  = document.getElementById("nivelSidebar");
    const elSidebarFill   = document.getElementById("sidebarProgress");
    const elSidebarBadge  = document.getElementById("sidebarBadge");

    if (elNivelSidebar) {
        const usuario = JSON.parse(localStorage.getItem("usuario")) || {};
        elNivelSidebar.textContent = `${usuario.nombre || "Usuario"} — ${PuntosActuales} EXP`;
    }
    if (elSidebarFill)  elSidebarFill.style.width  = progreso + "%";
    if (elSidebarBadge) elSidebarBadge.textContent = (NombreRango || "Novato") + " ⚽";
}

// ── Animación de número (contador) ──────────────────────────
function animarNumero(el, valorFinal, sufijo = "") {
    const valorInicial = parseInt(el.textContent) || 0;
    if (valorInicial === valorFinal) return;

    const duracion = 800;
    const inicio   = performance.now();

    function paso(ahora) {
        const t = Math.min((ahora - inicio) / duracion, 1);
        const ease = 1 - Math.pow(1 - t, 3);   // ease-out cubic
        const actual = Math.round(valorInicial + (valorFinal - valorInicial) * ease);
        el.textContent = actual + sufijo;
        if (t < 1) requestAnimationFrame(paso);
    }
    requestAnimationFrame(paso);
}

// ── Celebración de subida de rango ──────────────────────────
function mostrarCelebracionRango(nombreRango, puntos) {
    // Eliminar anterior si existe
    document.getElementById("rankUpOverlay")?.remove();

    const overlay = document.createElement("div");
    overlay.id    = "rankUpOverlay";
    overlay.style.cssText = `
        position: fixed; inset: 0;
        background: rgba(0,0,0,0.85);
        z-index: 9999;
        display: flex; align-items: center; justify-content: center;
        animation: fadeInOverlay 0.3s ease;
    `;

    overlay.innerHTML = `
        <style>
            @keyframes fadeInOverlay { from { opacity:0 } to { opacity:1 } }
            @keyframes popIn  { from { transform:scale(0.5); opacity:0 } to { transform:scale(1); opacity:1 } }
            @keyframes floatUp { 0%{transform:translateY(0);opacity:1} 100%{transform:translateY(-40px);opacity:0} }
            .rankup-box {
                text-align: center;
                animation: popIn 0.5s cubic-bezier(0.34,1.56,0.64,1) both;
                padding: 40px 56px;
                background: #13161e;
                border: 1px solid #2a2a3e;
                border-radius: 24px;
                box-shadow: 0 0 60px rgba(79,142,255,0.25);
                max-width: 380px;
            }
            .rankup-emoji { font-size: 72px; display:block; margin-bottom:12px; }
            .rankup-title {
                font-family: 'Rajdhani', 'Inter', sans-serif;
                font-size: 13px; letter-spacing: 4px;
                color: #6b7280; text-transform: uppercase; margin-bottom:6px;
            }
            .rankup-nombre {
                font-family: 'Rajdhani', 'Inter', sans-serif;
                font-size: 36px; font-weight: 700;
                color: #f0b429; letter-spacing: 2px;
                text-transform: uppercase; margin-bottom: 8px;
            }
            .rankup-puntos {
                font-size: 14px; color: #6b7280; margin-bottom: 28px;
            }
            .rankup-btn {
                padding: 12px 32px; border-radius: 10px;
                border: none; background: #4f8eff;
                color: white; font-size: 15px; font-weight: 600;
                cursor: pointer; transition: background 0.2s;
            }
            .rankup-btn:hover { background: #3a72d6; }
        </style>
        <div class="rankup-box">
            <span class="rankup-emoji">🏆</span>
            <div class="rankup-title">¡Subiste de rango!</div>
            <div class="rankup-nombre">${nombreRango}</div>
            <div class="rankup-puntos">${puntos} EXP acumulados</div>
            <button class="rankup-btn" onclick="document.getElementById('rankUpOverlay').remove()">
                ¡Seguir jugando! 🚀
            </button>
        </div>
    `;

    document.body.appendChild(overlay);

    // Auto-cerrar tras 6 segundos
    setTimeout(() => overlay?.remove(), 6000);

    // Partículas flotantes
    lanzarParticulas();
}

// ── Partículas de celebración ────────────────────────────────
function lanzarParticulas() {
    const emojis = ["⭐","🎉","✨","🏅","💥","🔥","🎊"];
    for (let i = 0; i < 18; i++) {
        setTimeout(() => {
            const p = document.createElement("div");
            p.textContent = emojis[Math.floor(Math.random() * emojis.length)];
            p.style.cssText = `
                position: fixed;
                left: ${10 + Math.random() * 80}vw;
                top: ${20 + Math.random() * 60}vh;
                font-size: ${18 + Math.random() * 24}px;
                z-index: 10000;
                pointer-events: none;
                animation: floatUp ${0.8 + Math.random() * 1}s ease forwards;
            `;
            document.body.appendChild(p);
            setTimeout(() => p.remove(), 2000);
        }, i * 120);
    }
}

// Exponer globalmente
window.sumarEXP        = sumarEXP;
window.iniciarSocketEXP = iniciarSocketEXP;
window.actualizarUIexp  = actualizarUIexp;