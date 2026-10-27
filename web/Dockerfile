# Multi-stage Dockerfile for SismoWatch React Web Platform
FROM node:20-alpine AS build

WORKDIR /app

ARG VITE_CARTO_API_KEY
ARG VITE_API_URL
ENV VITE_CARTO_API_KEY=$VITE_CARTO_API_KEY
ENV VITE_API_URL=$VITE_API_URL

COPY package.json ./
RUN npm install

COPY . .
RUN npm run build

# Stage 2: Serve with Nginx
FROM nginx:alpine

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 3000

CMD ["nginx", "-g", "daemon off;"]
