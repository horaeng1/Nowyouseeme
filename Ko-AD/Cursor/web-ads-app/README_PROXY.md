# Vite Proxy Configuration

## Backend Server Setup

The frontend development server (Vite) proxies all `/api/*` requests to the backend server.

### Default Configuration

- **Frontend (Vite)**: `http://localhost:5173`
- **Backend (Express)**: `http://localhost:4000`
- **Proxy Rule**: `/api/*` → `http://localhost:4000/api/*`

### Starting the Servers

1. **Start Backend Server** (in `server/` directory):
   ```bash
   cd server
   npm install
   npm run dev
   ```
   The backend should start on port 4000 and log:
   ```
   API server listening on http://localhost:4000
   Upload endpoint: POST http://localhost:4000/api/upload
   ```

2. **Start Frontend Dev Server** (in `web-ads-app/` directory):
   ```bash
   cd web-ads-app
   npm install
   npm run dev
   ```
   The frontend should start on port 5173.

### Troubleshooting

If you see `ECONNREFUSED` errors:

1. **Check if backend is running**: 
   - Visit `http://localhost:4000/api/health` in your browser
   - Should return `{"ok":true,"timestamp":...}`

2. **Check backend port**:
   - Backend uses `process.env.PORT || 4000`
   - Check `server/.env` or environment variables

3. **Update Vite proxy if needed**:
   - Edit `vite.config.js`
   - Change `target: 'http://localhost:4000'` to match your backend port

4. **Check proxy logs**:
   - Vite terminal will show proxy requests
   - Look for `[Vite Proxy]` messages

### API Endpoints

- `POST /api/upload` - Upload video file
- `POST /api/generate-ad` - Generate AD for video
- `GET /api/health` - Health check
- `GET /api/jobs` - List jobs
- `GET /api/jobs/:id` - Get job by ID

