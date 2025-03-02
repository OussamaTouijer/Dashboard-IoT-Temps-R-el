document.addEventListener("DOMContentLoaded", function () {
    const ui = {
        tempValue: document.getElementById("temp-value"),
        humidityValue: document.getElementById("humidity-value"),
        status: document.getElementById("connection-status"),
        chart: null
    };

    // Vérification des éléments DOM
    if (!ui.tempValue || !ui.humidityValue || !ui.status) {
        console.error("Un ou plusieurs éléments DOM sont manquants.");
        return;
    }

    let mqttClient;
    let chartData = {
        labels: [],
        temperature: [],
        humidity: []
    };

    // Configuration du graphique
    const CHART_CONFIG = {
        type: "line",
        data: {
            labels: chartData.labels,
            datasets: [
                {
                    label: "Température (°C)",
                    data: chartData.temperature,
                    borderColor: "#e74c3c",
                    tension: 0.3,
                    fill: false
                },
                {
                    label: "Humidité (%)",
                    data: chartData.humidity,
                    borderColor: "#3498db",
                    tension: 0.3,
                    fill: false
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    type: "time",
                    time: {
                        unit: "minute",
                        tooltipFormat: "HH:mm:ss",
                        displayFormats: {
                            minute: "HH:mm"
                        }
                    },
                    title: { display: true, text: "Temps" }
                },
                y: {
                    beginAtZero: true,
                    title: { display: true, text: "Valeurs" }
                }
            },
            plugins: {
                tooltip: {
                    mode: "index",
                    intersect: false
                }
            }
        }
    };

    // Initialisation du graphique
    function initChart() {
        const ctx = document.getElementById("environmentChart")?.getContext("2d");
        if (!ctx) {
            console.error("Le canvas du graphique n'a pas été trouvé.");
            return;
        }
        ui.chart = new Chart(ctx, CHART_CONFIG);
    }

    // Connexion MQTT
    function connectMQTT() {
        if (!CONFIG?.MQTT?.endpoint || !CONFIG?.MQTT?.topic) {
            console.error("Configuration MQTT manquante ou invalide.");
            ui.status.className = "alert alert-danger";
            ui.status.textContent = "Erreur de configuration MQTT";
            return;
        }

        mqttClient = mqtt.connect(CONFIG.MQTT.endpoint, {
            username: CONFIG.MQTT.username,
            password: CONFIG.MQTT.password
        });

        mqttClient.on("connect", function () {
            ui.status.className = "alert alert-success";
            ui.status.textContent = "Connecté";
            mqttClient.subscribe(CONFIG.MQTT.topic, function (err) {
                if (err) {
                    console.error("Erreur lors de l'abonnement au topic", err);
                    ui.status.className = "alert alert-danger";
                    ui.status.textContent = "Erreur d'abonnement";
                }
            });
        });

        mqttClient.on("message", function (topic, message) {
            try {
                const data = JSON.parse(message.toString());
                if (data?.data) {
                    updateUI(data.data);
                } else {
                    console.warn("Données reçues invalides :", data);
                }
            } catch (e) {
                console.error("Erreur de parsing des données MQTT", e);
            }
        });

        mqttClient.on("error", function (err) {
            console.error("Erreur MQTT :", err);
            ui.status.className = "alert alert-danger";
            ui.status.textContent = "Erreur de connexion";
        });

        mqttClient.on("close", function () {
            ui.status.className = "alert alert-warning";
            ui.status.textContent = "Déconnecté";
        });
    }

    // Mise à jour de l'interface utilisateur
    function updateUI(data) {
        if (typeof data.temp !== "number" || typeof data.humidity !== "number") {
            console.warn("Données reçues invalides :", data);
            return;
        }

        // Mise à jour des valeurs
        ui.tempValue.textContent = data.temp.toFixed(1);
        ui.humidityValue.textContent = data.humidity.toFixed(1);

        // Ajout des nouvelles données au graphique
        const now = new Date();
        chartData.labels.push(now);
        chartData.temperature.push(data.temp);
        chartData.humidity.push(data.humidity);

        // Limite le nombre de points de données pour éviter une surcharge
        const maxDataPoints = CONFIG.CHART?.maxDataPoints || 100;
        if (chartData.labels.length > maxDataPoints) {
            chartData.labels.shift();
            chartData.temperature.shift();
            chartData.humidity.shift();
        }

        // Mise à jour du graphique
        ui.chart.update();

        // Mise à jour des données des capteurs
        updateSensorData(data.temp, data.humidity);
    }

    // Stockage des données des capteurs
    let sensorData = [];

    // Fonction pour ajouter les nouvelles valeurs reçues
    function updateSensorData(temperature, humidity) {
        const timestamp = new Date().toISOString();
        sensorData.push({ timestamp, temperature, humidity });

        // Limiter à 100 entrées pour éviter un fichier trop volumineux
        if (sensorData.length > 100) {
            sensorData.shift();
        }
    }

    // Fonction pour exporter en CSV ou JSON
    async function exportData(format) {
        let content, filename, mimeType;

        // Récupérer les données existantes (si le fichier existe)
        let existingData = [];
        try {
            const response = await fetch(format === "csv" ? "data.csv" : "data.json");
            if (response.ok) {
                if (format === "csv") {
                    const csvText = await response.text();
                    existingData = csvText.split("\n").slice(1).map(row => {
                        const [timestamp, temp, humidity] = row.split(",");
                        return { timestamp, temperature: parseFloat(temp), humidity: parseFloat(humidity) };
                    });
                } else if (format === "json") {
                    existingData = await response.json();
                }
            }
        } catch (error) {
            console.log(`Le fichier ${format === "csv" ? "data.csv" : "data.json"} n'existe pas, création d'un nouveau fichier.`);
        }

        // Fusionner les données existantes avec les nouvelles
        const mergedData = [...existingData, ...sensorData];

        // Générer le contenu du fichier
        if (format === "csv") {
            content = "Temps,Température (°C),Humidité (%)\n";
            mergedData.forEach((row) => {
                content += `${row.timestamp},${row.temperature},${row.humidity}\n`;
            });
            filename = "data.csv";
            mimeType = "text/csv";
        } else if (format === "json") {
            content = JSON.stringify(mergedData, null, 2);
            filename = "data.json";
            mimeType = "application/json";
        } else {
            console.error("Format d'exportation non supporté :", format);
            return;
        }

        // Télécharger le fichier
        downloadFile(content, filename, mimeType);
    }

    // Fonction générique de téléchargement
    function downloadFile(content, filename, mimeType) {
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    // Exposer les fonctions d'exportation globalement
    window.exportCSV = () => exportData("csv");
    window.exportJSON = () => exportData("json");

    // Initialisation
    initChart();
    connectMQTT();
});