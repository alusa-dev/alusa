const appJson = require('./app.json');
const { withAndroidManifest } = require('expo/config-plugins');

function isDevelopmentBuild() {
  if (process.env.EAS_BUILD_PROFILE) {
    return ['development', 'development-device'].includes(process.env.EAS_BUILD_PROFILE);
  }
  return process.env.EXPO_PUBLIC_ENVIRONMENT === 'development';
}

module.exports = ({ config }) => {
  const base = config ?? appJson.expo;
  const developmentBuild = isDevelopmentBuild();
  const infoPlist = base.ios?.infoPlist ?? {};
  const transportSecurity = infoPlist.NSAppTransportSecurity ?? {};

  const appConfig = {
    ...base,
    ios: {
      ...base.ios,
      infoPlist: {
        ...infoPlist,
        ...(developmentBuild
          ? { NSLocalNetworkUsageDescription: 'A Alusa acessa o servidor local para conectar o app ao ambiente de desenvolvimento.' }
          : {}),
        NSAppTransportSecurity: {
          ...transportSecurity,
          NSAllowsArbitraryLoads: false,
          NSAllowsLocalNetworking: developmentBuild,
          NSExceptionDomains: developmentBuild ? transportSecurity.NSExceptionDomains ?? {} : {},
        },
      },
    },
    android: { ...base.android },
  };

  return withAndroidManifest(appConfig, (modConfig) => {
    const application = modConfig.modResults.manifest.application?.[0];
    if (!application) throw new Error('Android manifest is missing its application node.');

    application.$ ??= {};
    if (developmentBuild) {
      application.$['android:usesCleartextTraffic'] = 'true';
    } else {
      delete application.$['android:usesCleartextTraffic'];
    }

    return modConfig;
  });
};
