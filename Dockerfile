FROM node:20-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY server.js calc.js extractor.js excelgen.js docxImages.js ./
COPY public ./public

RUN mkdir -p uploads output

EXPOSE 3000

CMD ["node", "server.js"]
