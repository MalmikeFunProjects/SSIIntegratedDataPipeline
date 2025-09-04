# Stage 1: Build stage
FROM node:20-alpine

RUN apk add --no-cache curl

# Set working directory
WORKDIR /app

# Copy package.json and yarn.lock to leverage Docker cache
COPY package.json yarn.lock ./

# Install Node.js dependencies
RUN yarn install

COPY . .

# Expose the port your Node.js app listens on
EXPOSE 3332

CMD ["yarn", "start"]
