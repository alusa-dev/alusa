const appJson = require('./app.json');

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

  return {
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
    android: {
      ...base.android,
      usesCleartextTraffic: developmentBuild,
    },
  };
};
