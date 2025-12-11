const fs = require('fs');
const path = require('path');

const basicAuthUser = process.env.CAP_BASIC_USER || 'dev';
const basicAuthPassword = process.env.CAP_BASIC_PASSWORD || 'dev';

const destinationsEnvExists = Boolean(process.env.destinations);
const hasVcapServices = Boolean(process.env.VCAP_SERVICES);

if (!destinationsEnvExists && !hasVcapServices) {
  const defaultEnvPath = path.join(__dirname, 'default-env.json');
  let destinations = [
    {
      name: 'srv-api',
      url: 'http://localhost:4004',
      type: 'HTTP',
      proxyType: 'Internet',
      authentication: 'BasicAuthentication',
      username: basicAuthUser,
      password: basicAuthPassword,
      forwardAuthToken: true,
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
        destinations = parsed.destinations;
      }
    } catch (error) {
      console.warn('[approuter] Failed to read default-env.json, using built-in local destinations');
    }
  }

  process.env.destinations = JSON.stringify(destinations);
  console.info('[approuter] Using local destinations for development:', destinations);
} else {
  console.info('[approuter] Using destinations from environment');
}

const Approuter = require('@sap/approuter');

const approuter = new Approuter();
approuter.start();
