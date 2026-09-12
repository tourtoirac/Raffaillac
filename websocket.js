const status = document.getElementById("status");

// Adresse à adapter
const socket = new WebSocket("ws://localhost:12201");

socket.onopen = () => {

    status.textContent = "Connecté.\nEnvoi du message...";

    socket.send(JSON.stringify({
        action: "connect",
        name: "Chins"
    }));
};

socket.onmessage = (event) => {

    status.textContent =
        "Réponse du serveur :\n\n" + event.data;
};

socket.onerror = (event) => {

    status.textContent = "Erreur de connexion.";
    console.error(event);
};

socket.onclose = (event) => {

    console.log("Connexion fermée", event);
};