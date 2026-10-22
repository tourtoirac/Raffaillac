# ---- Étape 1 : build de l'application ----
FROM node:20-alpine AS build

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY tsconfig.json vite.config.ts ./
COPY index.html game.html parties.html ./
COPY public ./public
COPY src ./src
# OBG/Common, outside this repository, given as the build context "common"
# (docker build --build-context common=../Common): src/ reaches it as ../../Common
COPY --from=common resources /Common/resources

# Public path of the application ("/obg/" when served under a sub-path)
ARG OBG_BASE=/
RUN OBG_BASE=$OBG_BASE npm run build

# ---- Étape 2 : serveur statique ----
FROM nginx:alpine

RUN rm -rf /usr/share/nginx/html/*

COPY --from=build /app/dist /usr/share/nginx/html/
# static site + /hautefort/ forwarded to the Air Force service
COPY nginx/default.conf /etc/nginx/conf.d/default.conf

# Game resources (Games/) are mounted as a volume at /usr/share/nginx/html/Games

EXPOSE 80

# CMD de l'image nginx : nginx -g 'daemon off;'