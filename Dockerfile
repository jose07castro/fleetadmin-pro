FROM node:20-slim

WORKDIR /app

# Copiamos los archivos de configuración
COPY package*.json ./
RUN npm install --production

# Copiamos todo el proyecto
COPY . .

# Configuramos el puerto para Render
ENV PORT=10000
EXPOSE 10000

# Ejecutamos el servidor principal que inicia el bot
CMD ["node", "server.js"]