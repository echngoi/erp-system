import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return;

          const modulePath = id.split('node_modules/')[1];
          const parts = modulePath.split('/');
          const pkg = parts[0].startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0];

          if (pkg === 'react' || pkg === 'react-dom' || pkg === 'scheduler') {
            return 'react-vendor';
          }

          if (pkg === 'antd') {
            const antdModule = parts[2] || 'core';
            return `antd-${antdModule}`;
          }
          if (pkg === '@ant-design/icons') return 'ant-icons';
          if (pkg.startsWith('rc-')) return `rc-${pkg.slice(3)}`;

          if (pkg === 'dayjs') return 'dayjs-vendor';
          if (pkg === 'axios') return 'axios-vendor';
          if (pkg === 'react-router-dom' || pkg === 'react-router') return 'router-vendor';
          if (pkg === '@reduxjs/toolkit' || pkg === 'react-redux' || pkg === 'redux') {
            return 'state-vendor';
          }

          return 'vendor-misc';
        },
      },
    },
    chunkSizeWarningLimit: 600,
  },
})
