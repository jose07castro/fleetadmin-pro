const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 10000;

// Servir archivos de la carpeta raíz
app.use(express.static(__dirname));

// Ruta principal
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
    console.log('Servidor activo en puerto ' + PORT);
});