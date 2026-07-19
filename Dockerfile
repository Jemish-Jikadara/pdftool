FROM node:18-bullseye-slim

# System deps needed by the PDF tools:
# - graphicsmagick + ghostscript: PDF -> Image, and PDF compression
# - qpdf: Unlock PDF (removing a password you already know)
# - libreoffice-writer: PDF <-> Word conversion
# Installing these in the image means Render / Railway / any Docker host
# gets them automatically — no manual server setup needed.
RUN apt-get update && apt-get install -y --no-install-recommends \
    graphicsmagick \
    ghostscript \
    qpdf \
    libreoffice-writer \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

# uploads/processed need to exist and be writable
RUN mkdir -p uploads processed

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "server.js"]
