// Ultra-high performance webhook buffer for burst handling
class WebhookBuffer {
  constructor() {
    this.buffer = [];
    this.maxSize = 100000; // Increased to 100k for extreme bursts
    this.flushInterval = 10; // Ultra-fast flush (10ms)
    this.isProcessing = false;
    this.overflowBuffer = []; // Emergency overflow buffer
    this.droppedCount = 0;
    this.batchSize = 5000; // Larger batches for efficiency
    
    // Start background flushing
    this.startFlushing();
  }
  
  // Ultra-fast add with exact same structure as before
  add(webhookData) {
    if (this.buffer.length >= this.maxSize) {
      if (this.overflowBuffer.length < 20000) {
        this.overflowBuffer.push({
          data: webhookData,
          timestamp: Date.now()
        });
        return;
      }
      
      // Drop oldest with minimal logging
      this.buffer.shift();
      this.droppedCount++;
    }
    
    this.buffer.push({
      data: webhookData,
      timestamp: Date.now()
    });
  }
  
  // Ultra-fast background flushing with larger batches
  startFlushing() {
    setInterval(async () => {
      if (this.isProcessing) return;
      
      // Process overflow buffer first with larger batches
      if (this.overflowBuffer.length > 0) {
        this.isProcessing = true;
        const overflowBatch = this.overflowBuffer.splice(0, this.batchSize);
        
        try {
          const { sendWebhookBatchToKafka } = await import('../services/kafka.service.js');
          await sendWebhookBatchToKafka(overflowBatch);
        } catch (error) {
          // Silent error handling - re-add to buffer
          if (this.buffer.length + overflowBatch.length <= this.maxSize) {
            this.buffer.unshift(...overflowBatch);
          } else {
            this.overflowBuffer.unshift(...overflowBatch);
          }
        }
        
        this.isProcessing = false;
        return;
      }
      
      // Process main buffer with larger batches
      if (this.buffer.length === 0) return;
      
      this.isProcessing = true;
      const batch = this.buffer.splice(0, this.batchSize);
      
      try {
        const { sendWebhookBatchToKafka } = await import('../services/kafka.service.js');
        await sendWebhookBatchToKafka(batch);
      } catch (error) {
        // Silent error handling - re-add failed batch
        this.buffer.unshift(...batch);
      }
      
      this.isProcessing = false;
    }, this.flushInterval);
  }
  
  // Get buffer status with minimal overhead
  getStatus() {
    return {
      buffered: this.buffer.length,
      overflow: this.overflowBuffer.length,
      maxSize: this.maxSize,
      processing: this.isProcessing,
      dropped: this.droppedCount,
      totalCapacity: this.maxSize + 20000
    };
  }
}

export const webhookBuffer = new WebhookBuffer();