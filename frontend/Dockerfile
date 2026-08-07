# Frontend Dockerfile with hot reload support
FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source code (volumes will override this in development)
COPY . .

# Expose port
EXPOSE 3000

# Set environment for React hot reload
ENV CHOKIDAR_USEPOLLING=true
ENV WATCHPACK_POLLING=true

# Start development server with hot reload
CMD ["npm", "start"]
