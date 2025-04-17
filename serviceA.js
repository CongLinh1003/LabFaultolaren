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
    failureThreshold: 2,  // Giảm từ 3 xuống 2
    resetTimeout: 5000    // Giảm từ 10s xuống 5s
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
async function withRetry(requestFn, maxRetries = 1, delay = 3000) {
    let attempt = 0;
    
    while (attempt < maxRetries) {
      try {
        return await requestFn();
      } catch (err) {
        attempt++;
        if (attempt >= maxRetries) {
          console.log(`Final attempt (${attempt}) failed!`);
          throw err;
        }
        console.log(`Retry attempt ${attempt}... Waiting ${delay}ms`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

// 3. Rate Limiter - CHỈ ÁP DỤNG CHO ENDPOINT CỤ THỂ
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 requests per windowMs
  message: 'Too many requests from this IP, please try again after 15 minutes'
});

// 4. Time Limiter
function withTimeout(requestFn, timeout = 5000, operationName = 'Operation') {
    return function() {
      console.log(`⌛ [${operationName}] Starting with timeout ${timeout}ms`);
      const startTime = Date.now();
      
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          const elapsed = Date.now() - startTime;
          console.error(`⏰ [${operationName}] Timeout after ${elapsed}ms (${timeout}ms limit)`);
          reject(new Error(`Request timed out after ${elapsed}ms`));
        }, timeout);
  
        requestFn.apply(this, arguments)
          .then(result => {
            clearTimeout(timer);
            const elapsed = Date.now() - startTime;
            console.log(`✅ [${operationName}] Completed in ${elapsed}ms`);
            resolve(result);
          })
          .catch(err => {
            clearTimeout(timer);
            const elapsed = Date.now() - startTime;
            console.error(`❌ [${operationName}] Failed after ${elapsed}ms: ${err.message}`);
            reject(err);
          });
      });
    };
  }

// Demo endpoints

// Circuit Breaker endpoint - KHÔNG ÁP DỤNG RATE LIMITER
app.get('/circuit-breaker', async (req, res) => {
    try {
      // Thêm query param ?test=true để kích hoạt chế độ test nhanh
      const isTestMode = req.query.test === 'true';
      
      const result = await circuitBreaker(async () => {
        if (isTestMode) {
          // Chế độ test: Luôn fail trong 2 lần đầu
          if (circuitBreakerState.failureCount < 2) {
            throw new Error('[TEST MODE] Forced failure to trigger CB faster');
          }
          return { data: 'Success after test failures' };
        }
        
        // Chế độ bình thường: Fail ngẫu nhiên 80%
        if (Math.random() < 0.8) {
          throw new Error('Service B failed randomly');
        }
        const response = await axios.get('http://localhost:3001/api');
        return response.data;
      })();
      
      res.json({
        ...result,
        _metadata: {
          testMode: isTestMode,
          cbState: {
            failures: circuitBreakerState.failureCount,
            isOpen: circuitBreakerState.isOpen
          }
        }
      });
      
    } catch (err) {
      res.status(500).json({ 
        error: err.message,
        cbState: circuitBreakerState
      });
    }
  });

// Retry endpoint - KHÔNG ÁP DỤNG RATE LIMITER
app.get('/retry', async (req, res) => {
    try {
      let logs = [];
      
      const result = await withRetry(async () => {
        const attempt = logs.length + 1;
        logs.push(`Attempt ${attempt}: Calling Service B...`);
        
        try {
          const response = await axios.get('http://localhost:3001/api', {
            validateStatus: function (status) {
              return status < 500; // Chấp nhận cả status 4xx
            }
          });
          
          if (typeof response.data === 'object') {
            logs.push(`Attempt ${attempt}: Success!`);
            return response.data;
          } else {
            throw new Error('Invalid response format');
          }
        } catch (err) {
          logs.push(`Attempt ${attempt}: Failed - ${err.message}`);
          throw err;
        }
      }, 3, 1000);
      
      res.json({
        success: true,
        data: result,
        logs: logs
      });
      
    } catch (err) {
      res.status(500).json({
        success: false,
        error: err.message,
        logs: logs
      });
    }
  });

// Timeout endpoint - KHÔNG ÁP DỤNG RATE LIMITER
app.get('/timeout', async (req, res) => {
    try {
      const result = await withTimeout(async () => {
        console.log('🌐 Calling Service B /slow-api...');
        const response = await axios.get('http://localhost:3001/slow-api');
        return response.data;
      }, 3000, 'Slow API Call')();
      
      res.json({
        status: 'success',
        data: result,
        message: 'Request completed within time limit'
      });
    } catch (err) {
      console.error('💥 Timeout Error Details:', {
        url: req.originalUrl,
        error: err.message,
        timestamp: new Date().toISOString()
      });
      
      res.status(504).json({
        status: 'error',
        error: err.message,
        details: 'Service did not respond in time',
        timestamp: new Date().toISOString()
      });
    }
  });

// Rate Limit endpoint - CHỈ ENDPOINT NÀY ÁP DỤNG RATE LIMITER
app.get('/rate-limit', apiLimiter, (req, res) => {
  res.json({ 
    message: 'This endpoint is rate limited. Try refreshing more than 5 times in 15 minutes.',
    timestamp: new Date().toISOString()
  });
});

app.listen(PORT, () => {
  console.log(`Service A running on http://localhost:${PORT}`);
});