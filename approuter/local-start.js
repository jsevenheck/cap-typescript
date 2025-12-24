const fs = require('fs');
const path = require('path');

const basicAuthUser = process.env.CAP_BASIC_USER || 'dev';
const basicAuthPassword = process.env.CAP_BASIC_PASSWORD || 'dev';

const destinationsEnvExists = Boolean(process.env.destinations);
const hasVcapServices = Boolean(process.env.VCAP_SERVICES);
const isCloudFoundry = Boolean(process.env.VCAP_APPLICATION);

const xsAppLocalPath = path.join(__dirname, 'xs-app.local.json');
const startOptions = {};

if (!isCloudFoundry && fs.existsSync(xsAppLocalPath)) {
  startOptions.xsappConfig = xsAppLocalPath;
  console.info('[approuter] Using local xs-app.local.json for development.');
}

if (!destinationsEnvExists && !hasVcapServices) {
  const defaultEnvPath = path.join(__dirname, 'default-env.json');
  let destinations = [
    {
      name: 'srv-api',
      url: 'http://localhost:4004',
      type: 'HTTP',
      proxyType: 'Internet',
      // Mocked auth expects Basic Auth for local development.
      authentication: 'BasicAuthentication',
      user: basicAuthUser,
      password: basicAuthPassword,
      forwardAuthToken: false,
      strictSSL: false,
    },
    {
      name: 'ui5-hr-admin',
      url: 'http://localhost:8081',
      type: 'HTTP',
      proxyType: 'Internet',
      authentication: 'NoAuthentication',
      forwardAuthToken: false,
      strictSSL: false,
    },
  ];

  if (fs.existsSync(defaultEnvPath)) {
    try {
      const content = fs.readFileSync(defaultEnvPath, 'utf8');
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed.destinations) && parsed.destinations.length > 0) {
        // Validate each destination object
        const isValidDestination = (dest) =>
          dest &&
          typeof dest.name === 'string' &&
          typeof dest.url === 'string' &&
          typeof dest.type === 'string';
        const validDestinations = parsed.destinations.filter(isValidDestination);
        if (validDestinations.length < parsed.destinations.length) {
          console.warn(
            '[approuter] Some destinations in default-env.json are missing required fields and will be ignored.',
          );
        }
        if (validDestinations.length > 0) {
          destinations = validDestinations;
        }
      }
    } catch (error) {
      console.warn(
        '[approuter] Failed to read default-env.json, using built-in local destinations',
      );
      console.error('[approuter] Error details:', error && error.stack ? error.stack : error);
    }
  }

  process.env.destinations = JSON.stringify(destinations);
  console.info('[approuter] Using local destinations for development:', destinations);
} else {
  console.info('[approuter] Using destinations from environment');
}

const Approuter = require('@sap/approuter');

const approuter = new Approuter();
approuter.start(startOptions);
