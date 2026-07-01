FROM node:20-slim

# Install python3 and build dependencies
RUN apt-get update && apt-get install -y python3 ffmpeg build-essential && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 3000

CMD ["node", "index.js"]
