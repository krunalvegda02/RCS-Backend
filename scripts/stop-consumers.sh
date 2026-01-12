#!/bin/bash

# Stop all Kafka consumers
echo "🛑 Stopping RCS Kafka Consumers..."

# Function to stop a consumer
stop_consumer() {
    local name=$1
    if [ -f "pids/$name.pid" ]; then
        local pid=$(cat pids/$name.pid)
        if kill -0 $pid 2>/dev/null; then
            kill $pid
            echo "✅ $name stopped (PID: $pid)"
        else
            echo "⚠️  $name was not running"
        fi
        rm -f pids/$name.pid
    else
        echo "⚠️  No PID file found for $name"
    fi
}

# Stop consumers
stop_consumer "Webhook Consumer"
stop_consumer "Batch Entries Consumer"
stop_consumer "Stats Consumer"

echo ""
echo "🎉 All Kafka consumers stopped!"