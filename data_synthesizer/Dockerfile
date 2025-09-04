# Use official Go image
FROM golang:1.24.5-alpine3.22

RUN apk add --no-cache curl

# Set working directory
WORKDIR /app

# Copy go.mod and go.sum before copying source code
COPY go.mod go.sum ./
RUN go mod download

# Copy the rest of the source code
COPY . .
COPY sample.env .env

EXPOSE 4200
EXPOSE 2122

# Run the application
CMD ["go", "run", "main.go"]
