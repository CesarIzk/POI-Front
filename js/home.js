 const API_URL = "https://poi-back-production-7931.up.railway.app";

        // ── Utilidades ──────────────────────────────────────────────
        function showToast(msg, type = "success") {
            const t = document.getElementById("toast");
            t.textContent = msg;
            t.className = "toast show" + (type === "error" ? " error" : "");
            setTimeout(() => { t.className = "toast"; }, 3000);
        }

        function hideLoading() {
            const el = document.getElementById("loadingOverlay");
            el.style.opacity = "0";
            setTimeout(() => el.remove(), 400);
        }

        // ── Auth guard ───────────────────────────────────────────────
        const usuario = JSON.parse(localStorage.getItem("usuario"));
        const token   = localStorage.getItem("token");

        if (!usuario || !token) {
            window.location.href = "index.html";
        }

        // ── Perfil ───────────────────────────────────────────────────
        function renderPerfil(u) {
            document.getElementById("nombreUsuario").textContent = u.nombre || u.Nombre || "Usuario";

            const nivel = u.nivel ?? u.Nivel ?? 1;
            const exp   = u.exp   ?? u.Exp   ?? u.puntos ?? u.Puntos ?? 0;

            document.getElementById("nivelUsuario").textContent = "Nv " + nivel;
            document.getElementById("expUsuario").textContent   = exp + " EXP";

            // Rango
            const rangos = ["NOVATO", "APRENDIZ", "JUGADOR TITULAR", "VETERANO", "LEYENDA"];
            const rango  = rangos[Math.min(Math.floor(nivel / 5), rangos.length - 1)];
            document.getElementById("rankUsuario").textContent = rango;

            // Barra de progreso (EXP dentro del nivel actual, cada nivel = 100 EXP)
            const pct = exp % 100;
            setTimeout(() => {
                document.getElementById("progressFill").style.width = pct + "%";
            }, 300);
            document.getElementById("expLabel").textContent =
                pct + " / 100 EXP para nivel " + (nivel + 1);

            // Stats logros
            document.getElementById("expTotal").textContent = exp;
        }

        // ── Tareas ───────────────────────────────────────────────────
        let tareasData = [];

        async function cargarTareas(idUsuario) {
            try {
                const res = await fetch(`${API_URL}/api/tareas/${idUsuario}`, {
                    headers: { "Authorization": "Bearer " + token }
                });
                const data = await res.json();
                tareasData = Array.isArray(data) ? data : (data.tareas ?? []);
                renderTareas();
            } catch (err) {
                console.error("Error cargando tareas:", err);
                document.getElementById("taskList").innerHTML =
                    `<li style="color:var(--text-muted);font-size:13px;padding:8px">No se pudieron cargar las tareas</li>`;
            }
        }

        function renderTareas() {
            const lista = document.getElementById("taskList");

            if (!tareasData.length) {
                lista.innerHTML = `<li style="color:var(--text-muted);font-size:13px;padding:8px">Sin tareas activas 🎉</li>`;
                document.getElementById("tareasCompletadas").textContent = "0";
                return;
            }

            lista.innerHTML = "";
            let completadas = 0;

            tareasData.forEach(tarea => {
                const hecha = tarea.Estatus === true || tarea.Estatus === 1;
                if (hecha) completadas++;

                const li = document.createElement("li");
                li.className = "task-item" + (hecha ? " done" : "");
                li.dataset.id = tarea.IdTarea;

                li.innerHTML = `
                    <div class="task-check">${hecha ? "✓" : ""}</div>
                    <span class="task-desc">${tarea.Descripcion}</span>
                    <span class="task-exp">+${tarea.ValorPuntos ?? 0} EXP</span>
                `;

                li.addEventListener("click", () => toggleTarea(tarea, li));
                lista.appendChild(li);
            });

            document.getElementById("tareasCompletadas").textContent = completadas;
        }

        async function toggleTarea(tarea, el) {
            const nuevoEstatus = !(tarea.Estatus === true || tarea.Estatus === 1);
            const idUsuario = usuario.id ?? usuario.IdUsuario;

            try {
                const res = await fetch(`${API_URL}/api/tareas/${tarea.IdTarea}`, {
                    method: "PUT",
                    headers: {
                        "Content-Type": "application/json",
                        "Authorization": "Bearer " + token
                    },
                    body: JSON.stringify({ estatus: nuevoEstatus, idUsuario })
                });

                if (!res.ok) throw new Error("Error al actualizar");

                tarea.Estatus = nuevoEstatus;
                el.classList.toggle("done", nuevoEstatus);
                el.querySelector(".task-check").textContent = nuevoEstatus ? "✓" : "";
                el.querySelector(".task-desc").style.textDecoration = nuevoEstatus ? "line-through" : "";

                showToast(nuevoEstatus ? "✅ Tarea completada" : "↩️ Tarea reabierta");

                // Actualizar contador
                const completadas = tareasData.filter(t => t.Estatus === true || t.Estatus === 1).length;
                document.getElementById("tareasCompletadas").textContent = completadas;

                // Sumar EXP visualmente si se completó
                if (nuevoEstatus) {
                    const expActual = parseInt(document.getElementById("expUsuario").textContent) || 0;
                    const nueva = expActual + (tarea.ValorPuntos ?? 0);
                    document.getElementById("expUsuario").textContent = nueva + " EXP";
                    document.getElementById("expTotal").textContent = nueva;
                    const pct = nueva % 100;
                    document.getElementById("progressFill").style.width = pct + "%";
                    document.getElementById("expLabel").textContent =
                        pct + " / 100 EXP para nivel " + ((usuario.nivel ?? 1) + 1);
                }

            } catch (err) {
                console.error(err);
                showToast("Error al guardar tarea", "error");
            }
        }

        // ── Medals (rangos del usuario) ──────────────────────────────
        async function cargarRangos(idUsuario) {
            try {
                const res = await fetch(`${API_URL}/api/rangos/${idUsuario}`, {
                    headers: { "Authorization": "Bearer " + token }
                });
                const data = await res.json();
                const rangos = Array.isArray(data) ? data : (data.rangos ?? []);

                const iconos = ["🏅","🥇","🛡️","🎖️","👑","⚔️","🔥","💎"];
                const row    = document.getElementById("medalsRow");
                row.innerHTML = "";

                if (!rangos.length) {
                    row.innerHTML = `<span style="color:var(--text-muted);font-size:13px">Sin rangos aún</span>`;
                    return;
                }

                rangos.slice(0, 6).forEach((_, i) => {
                    const div = document.createElement("div");
                    div.className = "medal";
                    div.textContent = iconos[i % iconos.length];
                    row.appendChild(div);
                });
            } catch {
                // Silencioso — mostrar iconos por defecto
                document.getElementById("medalsRow").innerHTML =
                    ["🏅","🥇","🛡️","🎖️"].map(i => `<div class="medal">${i}</div>`).join("");
            }
        }

        // ── Countdown ────────────────────────────────────────────────
        function iniciarCountdown() {
            function actualizar() {
                const ahora    = new Date();
                const manana   = new Date(ahora);
                manana.setDate(ahora.getDate() + 1);
                manana.setHours(0, 0, 0, 0);

                const diff = manana - ahora;
                const hh   = String(Math.floor(diff / 3600000)).padStart(2, "0");
                const mm   = String(Math.floor((diff % 3600000) / 60000)).padStart(2, "0");
                const ss   = String(Math.floor((diff % 60000) / 1000)).padStart(2, "0");

                document.getElementById("countdown").textContent = `${hh}:${mm}:${ss}`;
            }
            actualizar();
            setInterval(actualizar, 1000);
        }

        // ── Init ─────────────────────────────────────────────────────
        async function init() {
            renderPerfil(usuario);
            iniciarCountdown();

            const idUsuario = usuario.id ?? usuario.IdUsuario ?? usuario.idusuario;

            await Promise.all([
                cargarTareas(idUsuario),
                cargarRangos(idUsuario)
            ]);

            hideLoading();
        }

        init();