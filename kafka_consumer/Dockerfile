# Use the official Python 3.12 slim image as base
FROM python:3.12-slim

# Set the working directory inside the container
WORKDIR /app

# Install system dependencies needed for Poetry and building packages
RUN apt-get update && apt-get install --no-install-recommends -y \
    curl \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Install Poetry
RUN curl -sSL https://install.python-poetry.org | POETRY_HOME=/etc/poetry python3 -

# Add Poetry's bin directory to the PATH environment variable
ENV PATH="/etc/poetry/bin:$PATH"

# Set Poetry to create virtualenvs inside the project directory
ENV POETRY_VIRTUALENVS_IN_PROJECT=false

# Ensure Python output is unbuffered (for real-time logs)
ENV PYTHONUNBUFFERED=1
ENV PYTHONFAULTHANDLER=1

# Copy only pyproject.toml first to leverage Docker layer caching
COPY pyproject.toml ./

# Install dependencies
RUN poetry --no-interaction --no-ansi --no-root install

# Copy the rest of the project files
COPY . .

# Expose port used by your application (if needed)
EXPOSE 3337 9001

# CMD ["poetry", "run", "python", "producer.py"]
ENTRYPOINT ["/app/scripts/entryPoint.sh"]
