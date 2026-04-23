FROM ghcr.io/puppeteer/puppeteer:21.5.0

USER root
RUN apt-get update && apt-get install -y \
    libxss1 \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

USER pptruser
WORKDIR /app
COPY --chown=pptruser:pptruser package*.json ./
RUN npm install
COPY --chown=pptruser:pptruser . .

ENV PORT=10000
EXPOSE 10000 

CMD ["node", "whatsapp-bot.js"]