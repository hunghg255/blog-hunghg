import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base: './' để bản build chạy được ở bất kỳ đường dẫn nào
// (blog nhúng nó tại /demos/facebook-patterns/).
export default defineConfig({
  base: './',
  plugins: [react()],
});
