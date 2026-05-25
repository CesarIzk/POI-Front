const router = require("express").Router();
const auth = require("../middleware/auth");
const db = require("../db");

router.use(auth);

// ─── GET /api/chats ──────────────────────────────────────────
router.get("/", async (req, res) => {
    const id_usuario = req.usuario.id;
    try {
        const [rows] = await db.query("CALL SP_ObtenerChatUsuario(?)", [id_usuario]);
        return res.json(rows[0] ?? []);
    } catch (err) {
        console.error("Error obteniendo chats:", err);
        return res.json({ success: false, message: "Error al obtener chats", error: err.message });
    }
});

// ─── POST /api/chats ─────────────────────────────────────────
// Acepta: { nombre, participantes: [id1, id2, ...] }
router.post("/", async (req, res) => {
    const id_usuario = req.usuario.id;
    const { nombre, participantes, usuarioDestino } = req.body;

    if (!nombre || nombre.trim() === "") {
        return res.json({ success: false, message: "El nombre del chat es obligatorio" });
    }
    if (nombre.trim().length > 30) {
        return res.json({ success: false, message: "El nombre no puede superar 30 caracteres" });
    }

    try {
        // 1. Crear el chat
        const [rows] = await db.query(
            "CALL SP_CrearChat(?, ?)",
            [id_usuario, nombre.trim()]
        );
        const nuevoIdChat = rows[0][0].NuevoIdChat;

        // 2. Agregar al creador como miembro
        await db.query(
            "CALL SP_GestionarMiembroGrupo('INSERT', ?, ?)",
            [nuevoIdChat, id_usuario]
        );

        // 3. Agregar participantes (array nuevo) o usuarioDestino (compatibilidad)
        const lista = participantes ?? (usuarioDestino ? [usuarioDestino] : []);
        for (const idP of lista) {
            if (String(idP) === String(id_usuario)) continue; // no duplicar creador
            await db.query(
                "CALL SP_GestionarMiembroGrupo('INSERT', ?, ?)",
                [nuevoIdChat, idP]
            );
        }

        return res.json({ success: true, id_chat: nuevoIdChat, message: "Chat creado correctamente" });

    } catch (err) {
        console.error("Error creando chat:", err);
        return res.json({ success: false, message: "Error al crear chat", error: err.message });
    }
});

// ─── GET /api/chats/users ────────────────────────────────────
router.get("/users", async (req, res) => {
    try {
        const [rows] = await db.query(
            "CALL SP_GestionarUsuario('SELECT', NULL, NULL, NULL, NULL, NULL, NULL, NULL)"
        );
        return res.json(rows[0] ?? []);
    } catch (err) {
        console.error("Error obteniendo usuarios:", err);
        return res.json({ success: false, message: "Error al obtener usuarios", error: err.message });
    }
});

// ─── GET /api/chats/:id/members ─────────────────────────────
router.get("/:id/members", async (req, res) => {
    const id_chat = req.params.id;
    try {
        const [rows] = await db.query(
            "CALL SP_GestionarMiembroGrupo('SELECT', ?, NULL)",
            [id_chat]
        );
        return res.json(rows[0] ?? []);
    } catch (err) {
        return res.json({ success: false, message: "Error al obtener miembros", error: err.message });
    }
});

// ─── POST /api/chats/:id/members ────────────────────────────
router.post("/:id/members", async (req, res) => {
    const id_chat = req.params.id;
    const { id_usuario } = req.body;
    if (!id_usuario) return res.json({ success: false, message: "id_usuario es obligatorio" });
    try {
        await db.query("CALL SP_GestionarMiembroGrupo('INSERT', ?, ?)", [id_chat, id_usuario]);
        return res.json({ success: true, message: "Usuario agregado al chat" });
    } catch (err) {
        return res.json({ success: false, message: "Error al agregar miembro", error: err.message });
    }
});

// ─── DELETE /api/chats/:id/members/:userId ───────────────────
router.delete("/:id/members/:userId", async (req, res) => {
    const { id, userId } = req.params;
    try {
        await db.query("CALL SP_GestionarMiembroGrupo('DELETE', ?, ?)", [id, userId]);
        return res.json({ success: true, message: "Usuario eliminado del chat" });
    } catch (err) {
        return res.json({ success: false, message: "Error al eliminar miembro", error: err.message });
    }
});

// ─── GET /api/chats/:id/messages ────────────────────────────
router.get("/:id/messages", async (req, res) => {
    const id_chat = req.params.id;
    try {
        const [rows] = await db.query(
            "CALL SP_GestionarMensaje('SELECT', NULL, ?, NULL, NULL, NULL, NULL, NULL)",
            [id_chat]
        );
        return res.json(rows[0] ?? []);
    } catch (err) {
        return res.json({ success: false, message: "Error al obtener mensajes", error: err.message });
    }
});

// ─── POST /api/chats/:id/messages ───────────────────────────
router.post("/:id/messages", async (req, res) => {
    const id_chat    = req.params.id;
    const id_usuario = req.usuario.id;
    const { mensaje } = req.body;
    if (!mensaje) return res.json({ success: false, message: "Mensaje vacío" });
    try {
        await db.query(
            "CALL SP_GestionarMensaje('INSERT', ?, ?, ?, ?, ?, ?, ?)",
            [id_usuario, id_chat, 0, mensaje, null, null, "enviado"]
        );
        return res.json({ success: true });
    } catch (err) {
        return res.json({ success: false, message: "Error al enviar mensaje", error: err.message });
    }
});

module.exports = router;