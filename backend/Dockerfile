FROM node:22-slim

# OCR (Tesseract com portugues) e rasterizacao de PDF (poppler) + openssl para o backup cifrado
RUN apt-get update \
 && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-por poppler-utils openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY scripts ./scripts

# Usuario sem privilegios; dados em volume
RUN useradd --create-home --uid 10001 app && mkdir /data && chown app:app /data
USER app
ENV HOST=0.0.0.0 PORT=3000 DB_PATH=/data/dados.db NODE_ENV=production
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npx", "tsx", "src/server.ts"]
