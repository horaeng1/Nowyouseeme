# Node.js 20 on Debian Bullseye (includes apt for python/ffmpeg)
FROM node:20-bullseye

# Install system dependencies (ffmpeg, python3, pip, libsndfile for audio)
RUN apt-get update && apt-get install -y \
    ffmpeg \
    python3 \
    python3-pip \
    libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# 1. Setup Python Environment
COPY Cursor/python/requirements.docker.txt ./requirements.txt
# Install Python dependencies globally
# Note: Coqui TTS may take a while to install
RUN pip3 install --no-cache-dir -r requirements.txt

# 2. Setup Node.js Backend
WORKDIR /app/server
COPY Cursor/server/package.json Cursor/server/package-lock.json* ./
RUN npm install

# 3. Copy Source Code
# Copy Python scripts to /app/python (matching code expectation)
COPY Cursor/python /app/python
# Copy Server source to /app/server
COPY Cursor/server /app/server

# 4. Copy TTS Voice Profile files
# These are reference audio files for Coqui XTTS voice cloning
COPY Cursor/python/tts_voice /app/python/tts_voice

# Create storage directories matching the code logic
RUN mkdir -p /app/server/storage/uploads /app/server/storage/results /app/server/storage/tts /app/server/storage/ad_json /app/server/storage/exports /app/server/storage/tmp

# Environment Variables
ENV PORT=4000
ENV NODE_ENV=production
ENV PYTHON_TTS_EXECUTABLE=python3
ENV PYTHONPATH=/app/python

# Expose port
EXPOSE 4000

# Start the server
CMD ["npm", "start"]