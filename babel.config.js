module.exports = {
  presets: ['module:@react-native/babel-preset'],
  env: {
    // Release / production APK only — Metro debug (`npm start` + run-android) keeps logs.
    production: {
      plugins: [
        [
          'transform-remove-console',
          {
            // Keep real failures visible in Logcat / crash tools.
            exclude: ['error', 'warn'],
          },
        ],
      ],
    },
  },
};
