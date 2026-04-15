const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 10000;

// EL "HACK" DEFINITIVO: Obliga a que todo se envíe como UTF-8
app.use((req, res, next) => {
    res.setHeader('Content-Type', 'text/html; charset=UTF-8');
    next();
});

// Servir archivos estáticos (CSS, JS, Imágenes)
app.use(express.static(path.join(__dirname)));

// Ruta principal para el index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Servidor FleetAdmin Pro corriendo en puerto ${PORT}`);
});