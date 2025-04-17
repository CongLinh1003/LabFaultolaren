const express = require('express');
const app = express();
const PORT = 3001;

app.use(express.json());

// Simulate a flaky service
app.get('/api', (req, res) => {
    try {
      if (Math.random() < 0.3) {
        // Trả về lỗi dạng JSON
        res.status(500).json({ 
          error: 'Service B encountered an error',
          timestamp: new Date().toISOString()
        });
      } else {
        res.json({ 
          data: 'Success from Service B',
          timestamp: new Date().toISOString()
        });
      }
    } catch (err) {
      // Đảm bảo luôn trả về JSON
      res.status(500).json({
        error: 'Internal Server Error',
        details: err.message
      });
    }
  });

// Simulate a slow service
app.get('/slow-api', (req, res) => {
  const start = Date.now();
  console.log('🐌 Starting slow-api processing...');
  
  setTimeout(() => {
    const processingTime = Date.now() - start;
    console.log(`🐢 slow-api completed in ${processingTime}ms`);
    res.json({ 
      data: 'Slow response from Service B',
      processingTime: `${processingTime}ms`,
      timestamp: new Date().toISOString()
    });
  }, 4000); // 4 seconds delay
});

app.listen(PORT, () => {
  console.log(`Service B running on http://localhost:${PORT}`);
});
