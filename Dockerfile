# ---- Étape 1 : build de l'application ----
FROM node:20-alpine AS build

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY tsconfig.json vite.config.ts ./
COPY index.html game.html ./
COPY public ./public
COPY src ./src

RUN npm run build

# ---- Étape 2 : serveur statique ----
FROM nginx:alpine

RUN rm -rf /usr/share/nginx/html/*

COPY --from=build /app/dist /usr/share/nginx/html/

# Game resources (Games/) are mounted as a volume at /usr/share/nginx/html/Games

EXPOSE 80

# CMD de l'image nginx : nginx -g 'daemon off;'