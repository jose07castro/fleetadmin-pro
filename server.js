const express = require('express');
const path = require('path');
const app = express();

// Render usa el puerto que él quiere, por eso usamos process.env.PORT
const PORT = process.env.PORT || 10000;

// Servir archivos estáticos desde la raíz
app.use(express.static(__dirname));

// Ruta principal
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Arrancar el motor
app.listen(PORT, () => {
    console.log('Servidor FleetAdmin Pro en marcha en puerto ' + PORT);
});