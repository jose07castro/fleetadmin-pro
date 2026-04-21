# Usa una imagen oficial de Node con soporte de Puppeteers
FROM ghcr.io/puppeteer/puppeteer:22.0.0

# Establecer el directorio de trabajo
WORKDIR /usr/src/app

# Variables de entorno para Puppeteer y Firebase
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable

# Copiar archivos de dependencia
COPY package*.json ./

# Instalar dependencias (incluyendo las nuevas como whatsapp-web.js)
RUN npm install

# Copiar el resto del código
COPY . .

# Exponer el puerto
EXPOSE 10000

# Iniciar el servidor que a su vez inicia el Bot
CMD ["node", "server.js"]
