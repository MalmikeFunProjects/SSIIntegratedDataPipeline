/**
 * Configuration module barrel exports
 * Provides a clean interface for importing configuration throughout the app
 */

// Main configuration objects
export {
  appConfig,
  serverConfig,
  veramoConfig,
  exposedMethods,
} from "./app.config";

// Individual environment variables (for specific use cases)
export {
  validateEnvironment,
  SERVER_PORT,
  BASE_URL,
  HOST_DID_WEB_URL,
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
} from "./environment";

// Types
export type {
  VeramoAgentConfig,
  VAgent,
  ServerConfig,
  AppConfig,
  IDatabaseConfigOptions,
  Environment,
  ExplorerConfig,
  IDidWithAccessRights,
  DIDPermission,
  IDidWithAccessRightsArgs,
  IDidAuthorisationCredentialArgs,
  IOpenAPISchemaArgs,
  DualAuthApiSchemaRouterOptions,
  OpenAPISchemaModifier,
} from "../types/veramo.types";

// Constants
export {
  VERAMO_EXPOSED_METHODS,
  type VeramoMethod,
  VERAMO_DUAL_AUTH_METHODS,
  type VeramoDualAuthMethod,
} from "../constants/veramo-methods";

// Database configuration and initialization
export {
  DatabaseConfig,
  databaseConfig,
  dbConnection,
  initializeDatabase,
} from "./database.config";
