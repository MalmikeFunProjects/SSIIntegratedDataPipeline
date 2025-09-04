import express, { Application } from "express";
import { IDIDManager, TAgent } from "@veramo/core";
import { ServerConfig, ExplorerConfig } from "../config";
import VeramoMiddlewareManager from "./veramo_middleware_manager";
import VeramoRouterManager from "./veramo_router_manager";
import VeramoDIDManager from "./veramo_did_manager";
import { IAuthorizationDIDPlugin } from "../veramo/veramo_create_default_auth_did";

export default class VeramoServer {
  private config: ServerConfig;
  private app?: Application;
  private agent: TAgent<IDIDManager & IAuthorizationDIDPlugin>;
  private middlewareManager: VeramoMiddlewareManager;
  private routerManager: VeramoRouterManager;
  private didManager: VeramoDIDManager;
  private isInitialized: boolean = false;

  constructor(config: ServerConfig, veramoAgent: TAgent<IDIDManager & IAuthorizationDIDPlugin>) {
    this.config = config;
    this.agent = veramoAgent;
    this.middlewareManager = new VeramoMiddlewareManager(this.agent);
    this.routerManager = new VeramoRouterManager(config, this.agent);
    this.didManager = new VeramoDIDManager(this.agent, config.baseUrl);
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) {
      console.log("Server already initialized");
      return;
    }

    try {
      // Create Express application
      this.app = express();

      this.app.use(express.json({ limit: '2mb', type: ['application/json','application/*+json'] }));
      this.app.use(express.urlencoded({ extended: true }));

      // Setup middleware
      this.setupMiddleware();

      // Setup routes
      this.setupRoutes();

      // Initialize default DID
      await this.didManager.initializeDefaultDID();

      this.isInitialized = true;
      console.log("Server initialized successfully");
    } catch (error) {
      console.error("Failed to initialize server:", error);
      throw error;
    }
  }

  private setupMiddleware(): void {
    if (!this.app) throw new Error("Express app not created");

    // CORS
    this.app.use(this.middlewareManager.setupCORS(this.config.corsOptions));

    // Add metrics middleware
    this.app.use(this.middlewareManager.setupHttpMetrics());
    // this.app.use("/agent", this.middlewareManager.veramoAgentMethodMetrics());

    // Add agent to request object
    this.app.use(this.middlewareManager.setupAgentMiddleware());

    // API endpoints with authentication
    this.app.use(
      "/agent",
      this.middlewareManager.setupAuthentication(this.config.apiKey)
    );

    this.app.use(
      "/agent",
      this.middlewareManager.checkAuthorisationToken()
    )
  }

  private setupRoutes(): void {
    if (!this.app) throw new Error("Express app not created");

    // DID Documents
    this.app.use(this.routerManager.setupWebDidDocRouter());

    // Messaging endpoint
    this.app.use("/messaging", this.routerManager.setupMessagingRouter());


    this.app.use("/agent", this.routerManager.setupAgentRouter());

    // OpenAPI schema
    // this.app.use("/open-api.json", this.routerManager.setupApiSchemaRouter());
    this.app.use("/open-api.json", this.routerManager.setupEnhancedApiRouter());

    // Metrics endpoint
    this.app.use("/metrics", this.routerManager.setupMetricsRouter());

    // Swagger docs
    const swaggerRouter = this.routerManager.setupSwaggerRouter();
    this.app.use("/api-docs", swaggerRouter.serve);
    this.app.use("/api-docs", swaggerRouter.serve, swaggerRouter.setup);

    this.app.get("/health", (req, res) => {
      res.json({
        status: "healthy",
        timestamp: new Date().toISOString(),
        version: "1.0.0",
        agent: "ready",
      });
    });

    // Agent explorer
    const explorerConfigs: ExplorerConfig[] = [
      {
        schemaUrl: `${this.config.baseUrl}/open-api.json`,
        name: "Local agent",
        apiKey: this.config.apiKey,
      },
    ];
    this.app.use(this.routerManager.setupExplorerRouter(explorerConfigs));
  }

  async start(): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    if (!this.app) {
      throw new Error("Server not properly initialized");
    }

    return new Promise((resolve, reject) => {
      try {
        this.app!.listen(this.config.port, () => {
          console.log(`Veramo Server running at ${this.config.baseUrl}`);
          console.log(`API Documentation: ${this.config.baseUrl}/api-docs`);
          console.log(`Agent Explorer: ${this.config.baseUrl}/agent-explore`);
          resolve();
        });
      } catch (error) {
        console.error("Failed to start server:", error);
        reject(error);
      }
    });
  }

  async stop(): Promise<void> {
    // Implementation for graceful shutdown if needed
    console.log("Server stopping...");
  }

  getApp(): Application {
    if (!this.app) {
      throw new Error("Server not initialized. Call initialize() first.");
    }
    return this.app;
  }

  getAgent(): TAgent<any> {
    return this.agent;
  }

  // Custom route addition
  addCustomRoute(path: string, router: express.Router): void {
    if (!this.app) throw new Error("Express app not created");
    this.app.use(path, router);
  }
}
