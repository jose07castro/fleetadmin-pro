const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 10000;

// 1. Dejamos que Express sirva los archivos libremente (JS, CSS, HTML, lo que sea)
app.use(express.static(__dirname));

// 2. Ruta principal: pase lo que pase, te lleva al inicio de la app
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// 3. Arranque del motor
app.listen(PORT, () => {
    console.log('Servidor FleetAdmin Pro rugiendo en el puerto ' + PORT);
});