// High-performance webhook buffer for burst handling
class WebhookBuffer {
  constructor() {
    this.buffer = [];
    this.maxSize = 50000; // Increased to 50k for 1 lakh webhooks
    this.flushInterval = 50; // Faster flush (50ms)
    this.isProcessing = false;
    this.overflowBuffer = []; // Emergency overflow buffer
    this.droppedCount = 0;
    
    // Start background flushing
    this.startFlushing();
  }
  
  // Add webhook to buffer (non-blocking with overflow protection)
  add(webhookData) {
    if (this.buffer.length >= this.maxSize) {
      // Try overflow buffer first
      if (this.overflowBuffer.length < 10000) {
        this.overflowBuffer.push({
          data: webhookData,
          timestamp: Date.now()
        });
        console.warn(`⚠️ Using overflow buffer: ${this.overflowBuffer.length}/10000`);
        return;
      }
      
      // Last resort: drop oldest (but count it)
      this.buffer.shift();
      this.droppedCount++;
      console.error(`🔴 DROPPED WEBHOOK! Total dropped: ${this.droppedCount}`);
    }
    
    this.buffer.push({
      data: webhookData,
      timestamp: Date.now()
    });
  }
  
  // Background flushing to Kafka with overflow handling
  startFlushing() {
    setInterval(async () => {
      if (this.isProcessing) return;
      
      // Process overflow buffer first
      if (this.overflowBuffer.length > 0) {
        this.isProcessing = true;
        const overflowBatch = this.overflowBuffer.splice(0, 2000);
        
        try {
          const { sendWebhookBatchToKafka } = await import('../services/kafka.service.js');
          await sendWebhookBatchToKafka(overflowBatch);
          console.log(`📤 Flushed ${overflowBatch.length} overflow webhooks to Kafka`);
        } catch (error) {
          console.error('Overflow Kafka send error:', error.message);
          // Re-add to main buffer if space available
          if (this.buffer.length + overflowBatch.length <= this.maxSize) {
            this.buffer.unshift(...overflowBatch);
          } else {
            this.overflowBuffer.unshift(...overflowBatch);
          }
        }
        
        this.isProcessing = false;
        return;
      }
      
      // Process main buffer
      if (this.buffer.length === 0) return;
      
      this.isProcessing = true;
      const batch = this.buffer.splice(0, 2000); // Increased batch size
      
      try {
        const { sendWebhookBatchToKafka } = await import('../services/kafka.service.js');
        await sendWebhookBatchToKafka(batch);
        
        if (batch.length > 100) {
          console.log(`📤 Flushed ${batch.length} webhooks to Kafka`);
        }
      } catch (error) {
        console.error('Kafka batch send error:', error.message);
        // Re-add failed batch to front of buffer
        this.buffer.unshift(...batch);
      }
      
      this.isProcessing = false;
    }, this.flushInterval);
  }
  
  // Get buffer status with overflow info
  getStatus() {
    return {
      buffered: this.buffer.length,
      overflow: this.overflowBuffer.length,
      maxSize: this.maxSize,
      processing: this.isProcessing,
      dropped: this.droppedCount,
      totalCapacity: this.maxSize + 10000
    };
  }
}

export const webhookBuffer = new WebhookBuffer();