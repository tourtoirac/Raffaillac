FROM nginx:alpine

RUN apk add --no-cache curl \
    && rm -rf /usr/share/nginx/html/*

COPY . /usr/share/nginx/html/

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 80

CMD ["/entrypoint.sh"]