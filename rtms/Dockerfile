# RTMS Dockerfile with hot reload support
FROM --platform=linux/amd64 node:18-slim

WORKDIR /app

# Install build dependencies and ffmpeg
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package*.json ./

# Install dependencies including nodemon
RUN npm install

# Copy source code (volumes will override this in development)
COPY . .

# Create data and logs directories
RUN mkdir -p /app/data/audio /app/data/transcripts /app/logs

# Expose port
EXPOSE 3002

# Use nodemon for hot reload in development
CMD ["npx", "nodemon", "server.js"]
