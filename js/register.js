// 🔧 Cambia esta URL por la de tu backend en Railway
const API_URL = "https://overbitterly-convuluted-katharina.ngrok-free.app";

document.getElementById("registerForm").addEventListener("submit", async (e) => {
    e.preventDefault();

    const nombre = document.getElementById("nombre").value;
    const alias = document.getElementById("alias").value;
    const telefono = document.getElementById("telefono").value;
    const email = document.getElementById("email").value;
    const password = document.getElementById("password").value;
    const confirm = document.getElementById("confirm").value;
    const mensaje = document.getElementById("mensaje");

    if (password !== confirm) {
        mensaje.innerText = "Las contraseñas no coinciden";
        return;
    }

    try {
        const res = await fetch(`${API_URL}/api/auth/register`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ nombre, alias, telefono, email, password, pais: "Mexico" })
        });

        const data = await res.json();
        console.log(data);

        if (data.success) {
            mensaje.innerText = "Registro exitoso 🎉";
            window.location.href = "index.html";
        } else {
            mensaje.innerText = data.message || "Error al registrarse";
        }

    } catch (error) {
        console.error(error);
        mensaje.innerText = "Error al conectar con el servidor";
    }
});
