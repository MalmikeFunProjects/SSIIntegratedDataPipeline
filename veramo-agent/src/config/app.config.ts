import { AppConfig } from "../types/veramo.types";
import { VERAMO_EXPOSED_METHODS, VERAMO_DUAL_AUTH_METHODS } from "../constants/veramo-methods";
import {
  SERVER_PORT,
  BASE_URL,
  API_KEY,
  AGENT_PATH,
  MESSAGING_PATH,
  SECRET_KEY,
  INFURA_PROJECT_ID,
  DEFAULT_PROVIDER,
  UNIVERSAL_RESOLVER_URL,
  SCHEMA_VALIDATION,
  DATABASE_URL,
  SQLITE_DB_FILE,
  ENVIRONMENT,
  validateEnvironment,
} from "./environment";

// Validate environment on module load
validateEnvironment();

/**
 * Complete application configuration
 */
export const appConfig: AppConfig = {
  server: {
    port: SERVER_PORT,
    baseUrl: BASE_URL,
    apiKey: API_KEY,
    agentPath: AGENT_PATH,
    messagingPath: MESSAGING_PATH,
    corsOptions: {
      origin: true,
      credentials: true,
    },
    swaggerOptions: {},
  },
  veramo: {
    infuraProjectId: INFURA_PROJECT_ID,
    secretKey: SECRET_KEY,
    defaultProvider: DEFAULT_PROVIDER,
    schemaValidation: SCHEMA_VALIDATION,
    universalResolverUrl: UNIVERSAL_RESOLVER_URL,
  },
  database: {
    environment: ENVIRONMENT,
    databaseUrl: DATABASE_URL,
    sqliteFile: SQLITE_DB_FILE,
  },
  exposedMethods: [...VERAMO_EXPOSED_METHODS],
  veramoDualAuthMethods: [...VERAMO_DUAL_AUTH_METHODS],
};

// Export individual configs for convenience
export const {
  server: serverConfig,
  veramo: veramoConfig,
  database: databaseConfigOptions,
  exposedMethods: exposedMethods,
  veramoDualAuthMethods: veramoDualAuthMethods,
} = appConfig;
