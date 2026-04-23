FROM ghcr.io/puppeteer/puppeteer:21.5.0

# Saltamos las instalaciones extras para evitar el error 100
WORKDIR /app

# Copiamos los archivos de la app
COPY --chown=pptruser:pptruser package*.json ./
RUN npm install
COPY --chown=pptruser:pptruser . .

# Configuramos el puerto para Render
ENV PORT=10000
EXPOSE 10000

# Arrancamos el bot
CMD ["node", "js/bot/whatsapp-bot.js"]