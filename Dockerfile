FROM node:20-slim

# Instalar dependencias de compilación para módulos nativos (sharp, etc.)
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    git \
    && rm -rf /var/lib/apt/lists/*

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