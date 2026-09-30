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

RUN apk add --no-cache curl \
    && rm -rf /usr/share/nginx/html/*

COPY --from=build /app/dist /usr/share/nginx/html/

# Ressources de jeu (plateaux, pions, règles) aux mêmes chemins qu'à l'origine
COPY Games/ /usr/share/nginx/html/Games/

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 80

CMD ["/entrypoint.sh"]