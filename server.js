const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 10000;

// 1. Forzar que todo sea UTF-8 para matar los jeroglíficos
app.use((req, res, next) => {
    res.setHeader('Content-Type', 'text/html; charset=UTF-8');
    next();
});

// 2. Servir archivos desde la raíz Y desde la carpeta www
app.use(express.static(__dirname));
app.use(express.static(path.join(__dirname, 'www')));

// 3. Ruta principal: busca el index.html en todos lados
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'), (err) => {
        if (err) {
            res.sendFile(path.join(__dirname, 'www', 'index.html'), (err2) => {
                if (err2) {
                    res.status(404).send('No se encontró el index.html. Verificá las carpetas.');
                }
            });
        }
    });
});

app.listen(PORT, () => {
    console.log('Servidor FleetAdmin Pro rugiendo en el puerto ' + PORT);
});