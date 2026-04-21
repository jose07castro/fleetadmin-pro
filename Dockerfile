# Usa una imagen liviana de Node.js
FROM node:20-slim

# Instala Chromium y todas las dependencias necesarias para Puppeteer en Debian
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    fonts-liberation \
    libnss3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    && rm -rf /var/lib/apt/lists/*

# Establece el directorio de trabajo
WORKDIR /usr/src/app

# Variables de entorno para que Puppeteer no descargue Chrome y use el del sistema
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Copia los archivos de configuración de dependencias
COPY package*.json ./

# Instala dependencias
RUN npm install

# Copia el resto del código del proyecto
COPY . .

# Expone el puerto que usa Express
EXPOSE 10000

# Inicia el servidor
CMD ["node", "server.js"]
