const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const config = getDefaultConfig(__dirname);

// O nucleo compartilhado fica fora da pasta do aplicativo (../core) e e importado como codigo-fonte TypeScript.
config.watchFolders = [...(config.watchFolders ?? []), path.resolve(__dirname, "../core")];

module.exports = config;
