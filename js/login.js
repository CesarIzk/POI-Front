// 🔧 Cambia esta URL por la de tu backend en Railway
const API_URL = "https://overbitterly-convuluted-katharina.ngrok-free.app";

document.getElementById("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();

    const email = document.getElementById("email").value;
    const password = document.getElementById("password").value;
    const mensaje = document.getElementById("mensaje");

    try {
        const res = await fetch(`${API_URL}/api/auth/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password })
        });

        const data = await res.json();

        if (data.success) {
            // Guardar token y datos del usuario en localStorage
            localStorage.setItem("token", data.token);
            localStorage.setItem("usuario", JSON.stringify(data.usuario));

            window.location.href = "home.html";
        } else {
            mensaje.innerText = data.message || "Credenciales incorrectas";
        }

    } catch (error) {
        console.error(error);
        mensaje.innerText = "Error al conectar con el servidor";
    }
});
