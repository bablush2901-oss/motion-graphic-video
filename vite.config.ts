import {defineConfig, loadEnv} from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig(({mode}) => {
  const env = loadEnv(mode, process.cwd(), 'PORT');
  const port = env.PORT || process.env.PORT || '3001';
  return {
  plugins: [react()],
  server: {host: '127.0.0.1', port: 5173, strictPort: true, proxy: {'/api': `http://127.0.0.1:${port}`, '/media': `http://127.0.0.1:${port}`, '/exports': `http://127.0.0.1:${port}`}},
  };
});
