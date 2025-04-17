const express = require('express');
const axios = require('axios');
const rateLimit = require('express-rate-limit');
const app = express();
const PORT = 3000;

// Middleware để parse JSON
app.use(express.json());

// 1. Circuit Breaker setup
let circuitBreakerState = {
  isOpen: false,
  lastFailureTime: null,
  failureCount: 0,
  failureThreshold: 3,
  resetTimeout: 10000 // 10 seconds
};

function circuitBreaker(requestFn) {
  return async function() {
    if (circuitBreakerState.isOpen) {
      const now = Date.now();
      if (now - circuitBreakerState.lastFailureTime > circuitBreakerState.resetTimeout) {
        circuitBreakerState.isOpen = false;
        console.log('Circuit breaker: Trying to reset...');
      } else {
        throw new Error('Service unavailable (Circuit Breaker open)');
      }
    }

    try {
      const result = await requestFn.apply(this, arguments);
      circuitBreakerState.failureCount = 0;
      return result;
    } catch (err) {
      circuitBreakerState.failureCount++;
      circuitBreakerState.lastFailureTime = Date.now();
      
      if (circuitBreakerState.failureCount >= circuitBreakerState.failureThreshold) {
        circuitBreakerState.isOpen = true;
      }
      
      throw err;
    }
  };
}

// 2. Retry setup
async function withRetry(requestFn, maxRetries = 3, delay = 1000) {
  let attempt = 0;
  
  while (attempt < maxRetries) {
    try {
      return await requestFn();
    } catch (err) {
      attempt++;
      if (attempt >= maxRetries) throw err;
      console.log(`Retry attempt ${attempt}...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

// 3. Rate Limiter
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 requests per windowMs
  message: 'Too many requests from this IP, please try again after 15 minutes'
});

// Apply rate limiting to all requests
app.use(apiLimiter);

// 4. Time Limiter
function withTimeout(requestFn, timeout = 5000) {
  return function() {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Request timed out'));
      }, timeout);

      requestFn.apply(this, arguments)
        .then(resolve)
        .catch(reject)
        .finally(() => clearTimeout(timer));
    });
  };
}

// Demo endpoints
app.get('/circuit-breaker', async (req, res) => {
  try {
    // Simulate calling Service B with circuit breaker
    const result = await circuitBreaker(async () => {
      // In a real scenario, this would be an API call to Service B
      if (Math.random() > 0.5) {
        throw new Error('Service B failed');
      }
      return { data: 'Success from Service B' };
    })();
    
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/retry', async (req, res) => {
  try {
    let attempts = 0;
    
    const result = await withRetry(async () => {
      attempts++;
      // Simulate a flaky service
      if (attempts < 3) {
        throw new Error('Temporary failure');
      }
      return { data: `Success after ${attempts} attempts` };
    });
    
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/timeout', async (req, res) => {
  try {
    const result = await withTimeout(async () => {
      // Simulate a long-running task
      await new Promise(resolve => setTimeout(resolve, 6000));
      return { data: 'This should timeout' };
    }, 3000)();
    
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/rate-limit', (req, res) => {
  res.json({ message: 'This endpoint is rate limited. Try refreshing more than 5 times in 15 minutes.' });
});

app.listen(PORT, () => {
  console.log(`Service A running on http://localhost:${PORT}`);
});