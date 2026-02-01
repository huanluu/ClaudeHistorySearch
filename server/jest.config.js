export default {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  moduleFileExtensions: ['js', 'ts', 'json'],
  collectCoverageFrom: ['src/**/*.ts'],
  coverageDirectory: 'coverage',
  verbose: true,
  // Use ts-jest to transform TypeScript files
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      useESM: true,
      tsconfig: {
        module: 'ESNext',
        moduleResolution: 'node',
        isolatedModules: true,
      }
    }]
  },
  // Resolve .js imports to .ts files
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1'
  },
  extensionsToTreatAsEsm: ['.ts'],
};
