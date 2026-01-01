// Test script for batch capability check
const testBatchCapability = async () => {
  const API_BASE = 'http://localhost:8000/api/v1';
  
  // Sample phone numbers for testing
  const testNumbers = [
    '9876543210', '8765432109', '7654321098', '6543210987', '5432109876',
    '9123456789', '8234567890', '7345678901', '6456789012', '5567890123',
    '9988776655', '8877665544', '7766554433', '6655443322', '5544332211',
    '9111222333', '8222333444', '7333444555', '6444555666', '5555666777'
  ];

  console.log(`Testing batch capability check with ${testNumbers.length} numbers...`);
  console.log('Numbers:', testNumbers);
  
  const startTime = Date.now();
  
  try {
    const response = await fetch(`${API_BASE}/messaging/usersBatchget`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        phoneNumbers: testNumbers
      })
    });
    
    const result = await response.json();
    const endTime = Date.now();
    
    console.log('\n=== BATCH CAPABILITY TEST RESULTS ===');
    console.log(`Status: ${response.status}`);
    console.log(`Total Time: ${endTime - startTime}ms`);
    console.log(`API Response Time: ${result.performance?.totalTime}ms`);
    console.log(`Numbers per Second: ${result.performance?.numbersPerSecond}`);
    console.log(`Average per Number: ${result.performance?.averageTimePerNumber}ms`);
    
    if (result.success) {
      const capable = result.data.results.filter(r => r.isCapable).length;
      const cached = result.data.results.filter(r => r.cached).length;
      
      console.log(`\nResults:`);
      console.log(`- RCS Capable: ${capable}/${testNumbers.length}`);
      console.log(`- Cached Results: ${cached}/${testNumbers.length}`);
      
      console.log('\nFirst 5 results:');
      result.data.results.slice(0, 5).forEach(r => {
        console.log(`  ${r.phoneNumber}: ${r.isCapable ? 'RCS' : 'SMS'} ${r.cached ? '(cached)' : ''}`);
      });
    } else {
      console.log('Error:', result.message);
    }
    
  } catch (error) {
    console.error('Test failed:', error.message);
  }
};

// Run the test
testBatchCapability();