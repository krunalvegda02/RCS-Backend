#!/bin/bash

# Start all Kafka consumers for RCS messaging system
echo "🚀 Starting RCS Kafka Consumers..."

# Function to start a consumer in background
start_consumer() {
    local name=$1
    local script=$2
    echo "Starting $name..."
    nohup npm run $script > logs/$name.log 2>&1 &
    echo $! > pids/$name.pid
    echo "✅ $name started (PID: $(cat pids/$name.pid))"
}

# Create directories for logs and PIDs
mkdir -p logs pids

# Start consumers
start_consumer "Webhook Consumer" "kafka-consumer"
start_consumer "Batch Entries Consumer" "batch-consumer" 
start_consumer "Stats Consumer" "stats-consumer"

echo ""
echo "🎉 All Kafka consumers started successfully!"
echo ""
echo "📋 Consumer Status:"
echo "- Webhook Consumer: Processing RCS webhooks"
echo "- Batch Entries Consumer: Processing campaign batch entries (4-5s processing)"
echo "- Stats Consumer: Processing message statistics"
echo ""
echo "📁 Logs: ./logs/"
echo "🔧 PIDs: ./pids/"
echo ""
echo "To stop all consumers: ./scripts/stop-consumers.sh"