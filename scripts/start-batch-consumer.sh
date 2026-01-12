#!/bin/bash

# Start Batch Entries Consumer
echo "🚀 Starting Batch Entries Consumer..."

# Set environment variables
export NODE_ENV=production
export WORKER_MODE=true

# Start the consumer
node src/workers/batchEntriesConsumer.js