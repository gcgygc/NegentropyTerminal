import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'terminal.negentropy.life',
  appName: "Negentropy Terminal",
  webDir: 'dist', 
  server: {
    hostname: 'observer.life', 
    androidScheme: 'https'
  },
  // 让后台不断网
  plugins: {
    CapacitorHttp: {
      enabled: true,
    },
  }
};

export default config;