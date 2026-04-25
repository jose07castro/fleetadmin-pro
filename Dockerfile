FROM ghcr.io/puppeteer/puppeteer:21.5.0

# Usamos la imagen que ya trae Chrome para evitar errores
WORKDIR /app

# Copiamos los archivos de configuración
COPY --chown=pptruser:pptruser package*.json ./
RUN npm install

# Copiamos todo el proyecto
COPY --chown=pptruser:pptruser . .

# Configuramos el puerto para Render
ENV PORT=10000
EXPOSE 10000

# Ejecutamos el servidor principal que inicia el bot
CMD ["node", "server.js"]