import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Vite Dev Server Configuration
 * 
 * Proxy Configuration:
 * - All requests to /api/* are proxied to the backend server
 * - Backend server runs on http://localhost:4000 (default)
 * - Change the target if your backend runs on a different port
 */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    open: true,
    proxy: {
      '/api': {
        target: 'http://localhost:4001',
        changeOrigin: true,
        secure: false,
        // Increase timeout for long-running operations (30 minutes)
        timeout: 1800000,  // 30 minutes
        proxyTimeout: 1800000,  // 30 minutes
        // Log proxy requests for debugging
        configure: (proxy, _options) => {
          // Set default timeout on http-proxy instance
          proxy.options.timeout = 1800000;
          proxy.options.proxyTimeout = 1800000;
          
          proxy.on('error', (err, req, res) => {
            console.error('[Vite Proxy] Proxy error:', err.message);
            console.error('[Vite Proxy] Error code:', err.code);
            if (!res.headersSent && res.writable) {
              res.writeHead(502, {
                'Content-Type': 'application/json',
              });
              res.end(JSON.stringify({
                status: 'error',
                message: '프록시 연결 오류: ' + err.message
              }));
            }
          });
          proxy.on('proxyReq', (proxyReq, req, res) => {
            console.log('[Vite Proxy] Proxying:', req.method, req.url, '->', proxyReq.path);
            // Set socket timeout to 30 minutes for long AD generation
            if (req.socket) {
              req.socket.setTimeout(1800000);
            }
            // Increase timeout on the proxied request (30 minutes)
            proxyReq.setTimeout(1800000);
          });
          proxy.on('proxyRes', (proxyRes, req, res) => {
            console.log('[Vite Proxy] Response:', req.url, '->', proxyRes.statusCode);
            // Set socket timeout on response
            if (proxyRes.socket) {
              proxyRes.socket.setTimeout(1800000);
            }
          });
          proxy.on('close', (req, socket, head) => {
            console.log('[Vite Proxy] Connection closed');
          });
        }
      },
      '/static': {
        target: 'http://localhost:4001',
        changeOrigin: true,
        secure: false,
        timeout: 600000,
        configure: (proxy, _options) => {
          proxy.on('error', (err, req, res) => {
            console.error('[Vite Proxy] Static file proxy error:', err.message);
          });
        }
      }
    }
  }
});

