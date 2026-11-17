const base = require('../../jest.config.base.js');

module.exports = {
  ...base,
  moduleNameMapper: {
    ...base.moduleNameMapper,
    '^@ohif/([^/]+)/src/(.*)$': '<rootDir>/../../platform/$1/src/$2',
    '^@ohif/ui-next/components/(.*)$': '<rootDir>/../../platform/ui-next/src/components/$1',
    '@ohif/(.*)': '<rootDir>/../../platform/$1/src',
    '^@cornerstonejs/([^/]+)/(.*)$': '<rootDir>/../../node_modules/@cornerstonejs/$1/dist/esm/$2',
    '^@cornerstonejs/([^/]+)$': '<rootDir>/../../node_modules/@cornerstonejs/$1/dist/esm',
  },
  // rootDir: "../.."
  // testMatch: [
  //   //`<rootDir>/platform/${pack.name}/**/*.spec.js`
  //   "<rootDir>/platform/app/**/*.test.js"
  // ]
};
