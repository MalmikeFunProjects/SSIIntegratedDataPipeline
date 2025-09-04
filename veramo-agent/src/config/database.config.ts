import { Entities, migrations } from "@veramo/data-store";
import { DataSource, DataSourceOptions } from "typeorm";
import {
  DATABASE_URL,
  SQLITE_DB_FILE,
  ENVIRONMENT
} from "./environment";
import { Environment, IDatabaseConfigOptions } from "../types/veramo.types";

type DatabaseType = "sqlite" | "postgres";
type CommonSettings = Pick<
  DataSourceOptions,
  "synchronize" | "migrationsRun" | "migrations" | "logging" | "entities"
>;

/**
 * Database configuration manager
 * Handles different database configurations based on environment
 */
export class DatabaseConfig {
  private readonly environment: Environment;
  private readonly databaseUrl: string;
  private readonly sqliteFile: string;
  private dataSource: DataSource | null = null;

  constructor(options: IDatabaseConfigOptions = {}) {
    this.environment = options.environment || ENVIRONMENT;
    this.databaseUrl = options.databaseUrl || DATABASE_URL;
    this.sqliteFile = options.sqliteFile || SQLITE_DB_FILE;
  }

  /**
   * Get common database settings shared across all environments
   */
  private getCommonSettings(): CommonSettings {
    return {
      synchronize: false,
      migrationsRun: true,
      migrations: migrations,
      logging: this.environment === "development",
      entities: Entities,
    };
  }

  /**
   * Get PostgreSQL-specific configuration
   */
  private getPostgresConfig(): DataSourceOptions {
    return {
      type: "postgres",
      url: this.databaseUrl,
      ...this.getCommonSettings(),
    };
  }

  /**
   * Get SQLite-specific configuration
   */
  private getSqliteConfig(): DataSourceOptions {
    return {
      type: "sqlite",
      database: this.sqliteFile,
      ...this.getCommonSettings(),
    };
  }

  /**
   * Get the appropriate database configuration based on environment
   */
  public getConfig(): DataSourceOptions {
    return this.environment === "production"
      ? this.getPostgresConfig()
      : this.getSqliteConfig();
  }

  /**
   * Get the database type for the current environment
   */
  public getDatabaseType(): DatabaseType {
    return this.environment === "production" ? "postgres" : "sqlite";
  }

  /**
   * Create a new DataSource instance
   */
  public createDataSource(): DataSource {
    if (!this.dataSource) {
      this.dataSource = new DataSource(this.getConfig());
    }
    return this.dataSource;
  }

  /**
   * Initialize the database connection
   */
  public async initialize(): Promise<DataSource> {
    const dataSource = this.createDataSource();

    if (!dataSource.isInitialized) {
      await dataSource.initialize();
    }

    return dataSource;
  }

  /**
   * Close the database connection
   */
  public async close(): Promise<void> {
    if (this.dataSource?.isInitialized) {
      await this.dataSource.destroy();
      console.log("Database connection closed");
    }
  }

  /**
   * Get current environment
   */
  public getEnvironment(): Environment {
    return this.environment;
  }
}

const options = {
  environment: ENVIRONMENT,
  databaseUrl: DATABASE_URL,
  sqliteFile: SQLITE_DB_FILE,
}

// Default database configuration instance
export const databaseConfig = new DatabaseConfig(options);

// Export the DataSource for backward compatibility
export const dbConnection = databaseConfig.createDataSource();

// Export the initialize function for backward compatibility
export const initializeDatabase = () => databaseConfig.initialize();

