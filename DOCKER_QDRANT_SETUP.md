# Docker & Qdrant Setup Guide

This document provides comprehensive instructions for setting up Docker and Qdrant vector database for your GenAI project.

## Table of Contents
1. [Docker Installation & Setup](#docker-installation--setup)
2. [Qdrant Vector Database Setup](#qdrant-vector-database-setup)
3. [Docker Compose Configuration](#docker-compose-configuration)
4. [Troubleshooting](#troubleshooting)

---

## Docker Installation & Setup

### Prerequisites for Docker
- Docker must be installed on your system
- Docker Desktop (recommended for macOS and Windows)
- Or Docker CLI and Docker Daemon for Linux

### Installation

#### macOS and Windows
Download and install [Docker Desktop](https://www.docker.com/products/docker-desktop)

#### Linux
Follow the [official Docker installation guide](https://docs.docker.com/engine/install/)

### Verify Docker Installation

```bash
docker --version
docker run hello-world
```

Expected output: Docker version information and a successful "Hello from Docker!" message.

### Basic Docker Commands

```bash
# Build an image from a Dockerfile
docker build -t image-name .

# Run a container
docker run -d --name container-name image-name

# Stop a running container
docker stop container-name

# Start a stopped container
docker start container-name

# View running containers
docker ps

# View all containers (including stopped)
docker ps -a

# View container logs
docker logs container-name

# Execute a command in a running container
docker exec -it container-name bash

# Remove a stopped container
docker rm container-name

# Remove an image
docker rmi image-name

# View all images
docker images
```

---

## Qdrant Vector Database Setup

Qdrant is a high-performance vector database optimized for semantic search and retrieval tasks. It's perfect for RAG (Retrieval Augmented Generation) applications.

### 1) Start Qdrant with Docker

```bash
docker run -d --name qdrant -p 6333:6333 -p 6334:6334 \
  -v qdrant_storage:/qdrant/storage \
  qdrant/qdrant:latest
```

**Parameters Explained:**
- `-d`: Run in detached mode (background)
- `--name qdrant`: Assign a name to the container
- `-p 6333:6333`: Map REST API port
- `-p 6334:6334`: Map gRPC port
- `-v qdrant_storage:/qdrant/storage`: Create a persistent storage volume for data persistence

### 2) Verify Qdrant is Running

Check if the container is running:

```bash
docker ps | grep qdrant
```

Test the REST API health check:

```bash
curl http://localhost:6333/health
```

Expected response:
```json
{"status":"ok"}
```

### 3) Access Qdrant Web UI (Dashboard)

Open your browser and navigate to:

```
http://localhost:6333/dashboard
```

This provides a visual interface to manage collections, view statistics, and debug.

### 4) Create a Collection

Using curl to create a new collection:

```bash
curl -X PUT http://localhost:6333/collections/documents \
  -H "Content-Type: application/json" \
  -d '{
    "vectors": {
      "size": 1536,
      "distance": "Cosine"
    }
  }'
```

**Parameters:**
- `size`: Vector dimension (e.g., 1536 for OpenAI embeddings)
- `distance`: Distance metric (Cosine, Euclidean, or Manhattan)

### 5) Insert Vectors

Insert vector embeddings with metadata:

```bash
curl -X PUT http://localhost:6333/collections/documents/points \
  -H "Content-Type: application/json" \
  -d '{
    "points": [
      {
        "id": 1,
        "vector": [0.1, 0.2, 0.3, ...],
        "payload": {
          "text": "example document content",
          "source": "document.pdf",
          "page": 1
        }
      },
      {
        "id": 2,
        "vector": [0.2, 0.3, 0.4, ...],
        "payload": {
          "text": "another document",
          "source": "document.pdf",
          "page": 2
        }
      }
    ]
  }'
```

### 6) Search Vectors

Perform semantic search:

```bash
curl -X POST http://localhost:6333/collections/documents/points/search \
  -H "Content-Type: application/json" \
  -d '{
    "vector": [0.1, 0.2, 0.3, ...],
    "limit": 10,
    "with_payload": true
  }'
```

**Parameters:**
- `vector`: Query vector (same dimension as collection)
- `limit`: Number of results to return
- `with_payload`: Include payload data in results

### 7) Query with Filters

Search with metadata filtering:

```bash
curl -X POST http://localhost:6333/collections/documents/points/search \
  -H "Content-Type: application/json" \
  -d '{
    "vector": [0.1, 0.2, 0.3, ...],
    "limit": 10,
    "filter": {
      "must": [
        {
          "key": "source",
          "match": {
            "value": "document.pdf"
          }
        }
      ]
    },
    "with_payload": true
  }'
```

### 8) Delete a Point

```bash
curl -X DELETE http://localhost:6333/collections/documents/points \
  -H "Content-Type: application/json" \
  -d '{
    "points": [1, 2]
  }'
```

### 9) Stop Qdrant

```bash
docker stop qdrant
```

### 10) Remove Qdrant (Clean Up)

```bash
docker rm qdrant
docker volume rm qdrant_storage
```

---

## Docker Compose Configuration

For easier management of Qdrant and other services, use Docker Compose.

### Create docker-compose.yml

Create a `docker-compose.yml` file in your project root:

```yaml
version: '3.8'

services:
  qdrant:
    image: qdrant/qdrant:latest
    container_name: qdrant
    ports:
      - "6333:6333"    # REST API
      - "6334:6334"    # gRPC
    volumes:
      - qdrant_storage:/qdrant/storage
    environment:
      - QDRANT_API_KEY=your-api-key-here
    restart: unless-stopped

volumes:
  qdrant_storage:
    driver: local
```

### Start Qdrant with Docker Compose

```bash
docker-compose up -d
```

### View Logs

```bash
docker-compose logs -f qdrant
```

### Stop All Services

```bash
docker-compose down
```

### Stop and Remove Volumes

```bash
docker-compose down -v
```

---

## Complete Multi-Service Docker Compose

For a complete setup with Qdrant and other services:

```yaml
version: '3.8'

services:
  qdrant:
    image: qdrant/qdrant:latest
    container_name: qdrant
    ports:
      - "6333:6333"
      - "6334:6334"
    volumes:
      - qdrant_storage:/qdrant/storage
    environment:
      - QDRANT_API_KEY=${QDRANT_API_KEY:-change-me}
    restart: unless-stopped
    networks:
      - app-network

  # Add other services here as needed
  # redis:
  #   image: redis:latest
  #   container_name: redis
  #   ports:
  #     - "6379:6379"
  #   networks:
  #     - app-network

networks:
  app-network:
    driver: bridge

volumes:
  qdrant_storage:
    driver: local
```

---

## Troubleshooting

### Qdrant Connection Issues

**Problem:** Cannot connect to Qdrant at localhost:6333

**Solution:**
1. Verify container is running:
   ```bash
   docker ps | grep qdrant
   ```
2. Check logs:
   ```bash
   docker logs qdrant
   ```
3. Ensure port 6333 is not in use:
   ```bash
   lsof -i :6333
   ```

### Port Already in Use

**Problem:** Port 6333 is already in use

**Solution:**
```bash
# Kill process using the port
lsof -ti:6333 | xargs kill -9

# Or use a different port in docker run command
docker run -d --name qdrant -p 6335:6333 -p 6336:6334 \
  -v qdrant_storage:/qdrant/storage \
  qdrant/qdrant:latest
```

### Docker Permission Denied

**Problem:** Docker command returns "permission denied"

**Solution (macOS/Linux):**
```bash
# Add user to docker group
sudo usermod -aG docker $USER

# Apply group changes
newgrp docker

# Verify
docker ps
```

### Data Persistence Issues

**Problem:** Data is lost when container restarts

**Solution:** Ensure volume is properly mounted and verify docker volume:
```bash
docker volume ls
docker volume inspect qdrant_storage
```

### Memory Issues

If Qdrant runs out of memory, increase Docker's memory limit:

```bash
docker run -d --name qdrant \
  --memory=4g \
  -p 6333:6333 -p 6334:6334 \
  -v qdrant_storage:/qdrant/storage \
  qdrant/qdrant:latest
```

Or in docker-compose.yml:

```yaml
services:
  qdrant:
    image: qdrant/qdrant:latest
    deploy:
      resources:
        limits:
          memory: 4G
```

---

## Performance Tips

1. **Vector Indexing**: Qdrant builds HNSW indices automatically. For large datasets, this can take time.
2. **Batch Operations**: Use batch insert/delete operations for better performance
3. **Snapshots**: Create regular snapshots for backup:
   ```bash
   curl -X POST http://localhost:6333/snapshots
   ```
4. **Payload Indexing**: Index frequently filtered fields for faster queries
5. **Connection Pooling**: In your application, use connection pooling for better performance

---

## Additional Resources

- [Qdrant Documentation](https://qdrant.tech/documentation/)
- [Docker Documentation](https://docs.docker.com/)
- [Docker Compose Reference](https://docs.docker.com/compose/compose-file/)
- [Qdrant API Reference](https://qdrant.tech/api-reference/)

