const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 * 
 * Note: react-native-screens Fabric import has been patched in node_modules
 * to prevent CodeGen errors when New Architecture is disabled
 */
const defaultConfig = getDefaultConfig(__dirname);

const config = {};

module.exports = mergeConfig(defaultConfig, config);
