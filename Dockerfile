# Usa Node 18 como pidió el usuario
FROM node:18

# Instala dependencias necesarias y añade el repositorio de Google Chrome para tener la versión STABLE
RUN apt-get update && apt-get install -y wget gnupg \
    && wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add - \
    && sh -c 'echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/dist/sources.list.d/google.list' \
    && apt-get update \
    && apt-get install -y google-chrome-stable fonts-ipafont-gothic fonts-wqy-zenhei fonts-thai-tlwg fonts-kacst fonts-freefont-ttf libxss1 \
      --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Establece el directorio de trabajo
WORKDIR /usr/src/app

# Variables de entorno críticas para Render
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable

# Copia los archivos de configuración
COPY package*.json ./

# Instala dependencias de Node
RUN npm install

# Copia todo el código fuente
COPY . .

# Expone el puerto de Render
EXPOSE 10000

# Ejecuta el servidor principal
CMD ["node", "server.js"]
