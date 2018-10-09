const { name: service } = require('./package.json');

module.exports = {
  service,
  plugins: ['serverless-workspaces-plugin'],
  provider: {
    name: 'aws',
    runtime: 'nodejs8.10',
    region: '${env:AWS_REGION, "eu-west-3"}',
    stage: '${opt:stage, "development"}',
    environment: {
      NODE_ENV: '${env:NODE_ENV, "production"}',
    },
  },
  package: {
    individually: true,
    excludeDevDependencies: true,
    exclude: ['**'],
  },
  functions: {
    create: {
      handler: 'functions/create/index.post',
      memorySize: 128,
      package: {
        include: [
          'functions/create/index.js',
          'functions/create/node_modules/**',
        ],
      },
      events: [
        {
          http: {
            path: '/',
            method: 'POST',
            cors: false,
          },
        },
      ],
    },
    fetch: {
      handler: 'functions/fetch/index.get',
      memorySize: 128,
      package: {
        include: [
          'functions/fetch/index.js',
          'functions/fetch/node_modules/**',
        ],
      },
      events: [
        {
          http: {
            path: '/',
            method: 'GET',
            cors: false,
          },
        },
      ],
    },
    update: {
      handler: 'functions/update/index.put',
      memorySize: 128,
      package: {
        include: [
          'functions/update/index.js',
          'functions/update/node_modules/**',
        ],
      },
      events: [
        {
          http: {
            path: '/',
            method: 'PUT',
            cors: false,
          },
        },
      ],
    },
    remove: {
      handler: 'functions/remove/index.delete',
      memorySize: 128,
      package: {
        include: [
          'functions/remove/index.js',
          'functions/remove/node_modules/**',
        ],
      },
      events: [
        {
          http: {
            path: '/',
            method: 'DELETE',
            cors: false,
          },
        },
      ],
    },
  },
};
