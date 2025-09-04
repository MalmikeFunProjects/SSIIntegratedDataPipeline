# Use official Go image
FROM golang:1.24.5-alpine3.22

# Install git and ssh so we can use our SSH credentials
RUN apk update && apk add --no-cache curl git openssh-client

# Set working directory
WORKDIR /app

# Create SSH directory and set proper permissions (for SSH option)
RUN mkdir -p ${HOME}/.ssh && chmod 700 ${HOME}/.ssh


# Add GitHub's host keys to known_hosts (more secure than disabling host checking)
RUN ssh-keyscan -t rsa,ecdsa,ed25519 github.com >> ${HOME}/.ssh/known_hosts

# Create SSH config
RUN echo "Host github.com\n\
    HostName github.com\n\
    User git\n\
    AddKeysToAgent yes\n\
    IdentityFile ${HOME}/.ssh/id_rsa\n\
    IdentitiesOnly yes" > ${HOME}/.ssh/config && \
    chmod 600 ${HOME}/.ssh/config

# Test SSH connection (optional - will show if it works)
RUN ssh -T git@github.com || true

# Copy go.mod and go.sum before copying source code
COPY go.mod go.sum ./
RUN go mod download

# Copy the rest of the source code
COPY . .
COPY sample.gitignore .gitignore
COPY sample.env .env

EXPOSE 3999

# Run the application
CMD ["/app/startup.sh"]
