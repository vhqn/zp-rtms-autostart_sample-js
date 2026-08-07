# Backend Dockerfile with hot reload support
FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies including nodemon
RUN npm install

# Copy source code (volumes will override this in development)
COPY . .

# Expose port
EXPOSE 3001

# Use nodemon for hot reload in development
CMD ["npx", "nodemon", "server.js"]
