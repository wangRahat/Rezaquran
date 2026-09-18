#!/bin/bash
npm install

# Install ffmpeg and ffprobe
apt-get update && apt-get install -y ffmpeg || true

# Verify
ffmpeg -version | head -1
echo "Build complete!"
