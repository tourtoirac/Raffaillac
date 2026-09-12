#!/bin/sh
set -e

CHABANAS_URL="${CHABANAS_URL:-http://obg-chabanas:80}"
MAX_RETRIES="${CHABANAS_MAX_RETRIES:-30}"
RETRY_INTERVAL="${CHABANAS_RETRY_INTERVAL:-2}"

check_chabanas() {
    curl -sf -m 5 -X POST \
        -H "Content-Type: application/json" \
        -d '{"game_name_list":["Waterloo"]}' \
        "${CHABANAS_URL}/game/list" >/dev/null 2>&1
}

echo "[Raffaillac] Vérification de l'API Chabanas : ${CHABANAS_URL}"

retries=0
while ! check_chabanas; do
    retries=$((retries + 1))
    if [ "$retries" -ge "$MAX_RETRIES" ]; then
        echo "[Raffaillac] ERREUR : l'API Chabanas ne répond pas après ${MAX_RETRIES} tentatives" >&2
        exit 1
    fi
    echo "[Raffaillac] En attente de l'API Chabanas... (tentative ${retries}/${MAX_RETRIES})"
    sleep "$RETRY_INTERVAL"
done

echo "[Raffaillac] L'API Chabanas répond."

exec nginx -g "daemon off;"