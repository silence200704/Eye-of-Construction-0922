FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html tsconfig*.json vite.config.ts ./
COPY src ./src
COPY public ./public
ENV VITE_BACKEND_ENABLED=true
RUN npm run build

FROM nginx:1.28-alpine
COPY deploy/nginx.conf /etc/nginx/nginx.conf
COPY --from=build /app/dist /usr/share/nginx/html
USER 101
EXPOSE 8080
