import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "in.hotelpilot.app",
  appName: "HotelPilot",
  webDir: "dist",
  // Live-URL loading: the native shell loads the deployed site directly, so any
  // web deploy is reflected in the installed app without a new APK. Only
  // shell-level changes (icon, splash, native permissions) need a rebuild.
  server: {
    url: "https://hotelpilot.in",
    androidScheme: "https",
    cleartext: false,
  },
  android: {
    allowMixedContent: false,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1500,
      launchAutoHide: true,
      backgroundColor: "#012019",
      androidSplashResourceName: "splash",
      androidScaleType: "CENTER_CROP",
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: false,
    },
  },
};

export default config;
