FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache python3 make g++ vips-dev

COPY package*.json ./
RUN npm ci --only=production

COPY . .

RUN mkdir -p uploads tiles

EXPOSE 3000 3001

CMD ["node", "src/app.js"]
