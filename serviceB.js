const express = require('express');
const app = express();
const PORT = 3001;

app.use(express.json());

// Simulate a flaky service
app.get('/api', (req, res) => {
  // Fail randomly 30% of the time
  if (Math.random() < 0.3) {
    res.status(500).json({ error: 'Service B encountered an error' });
  } else {
    res.json({ data: 'Success from Service B' });
  }
});

// Simulate a slow service
app.get('/slow-api', (req, res) => {
  setTimeout(() => {
    res.json({ data: 'Slow response from Service B' });
  }, 4000); // 4 seconds delay
});

app.listen(PORT, () => {
  console.log(`Service B running on http://localhost:${PORT}`);
});