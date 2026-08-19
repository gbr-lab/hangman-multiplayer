import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
    build: {
        outDir: 'dist',
            emptyOutDir: true,
              },
                server: {
                    port: 3000,
                        proxy: {
                              '/socket.io': {
                                      target: 'http://localhost:3000',
                                              ws: true
                                                    }
                                                        }
                                                          }
                                                          });
                                                          