import { Router } from "express";
import { getOpenApiSchema } from "@veramo/remote-client";
import { IAgent } from "@veramo/core";
import { IOpenAPISchemaArgs, OpenAPISchemaModifier } from "../../config";

/**
 * Flexible OpenAPI schema modifier that supports both function and class-based modifiers
 */
export class ModifyOpenAPISchema {
  private openApiSchemaArgs: IOpenAPISchemaArgs;

  constructor(openApiSchemaArgs: IOpenAPISchemaArgs) {
    this.openApiSchemaArgs = openApiSchemaArgs;
  }

  /**
   * Create router with schema modifications
   * Supports both function and object-based modifiers
   */
  modifySchema(modifiers: OpenAPISchemaModifier[]): Router {
    const router = Router();

    router.get("/", (req, res) => {
      const agent: IAgent = this.openApiSchemaArgs.agent;

      if (!agent) {
        return res.status(500).json({ error: "Agent not available" });
      }

      try {
        // Generate the base OpenAPI schema using the original Veramo method
        let openApiSchema = getOpenApiSchema(
          agent,
          "",
          this.openApiSchemaArgs.exposedMethods || agent.availableMethods(),
          this.openApiSchemaArgs.apiName,
          this.openApiSchemaArgs.apiVersion
        );

        // Set up the server URL
        const url =
          (req.headers["x-forwarded-proto"] || req.protocol) +
          "://" +
          req.hostname +
          this.openApiSchemaArgs.basePath;
        openApiSchema.servers = [{ url }];

        // Apply all modifiers
        for (const modifier of modifiers) {
          try {
            // Handle object-based modifier
            if (modifier.validate && !modifier.validate(openApiSchema)) {
              console.warn(
                `Modifier ${modifier.name} validation failed, skipping...`
              );
              continue;
            }
            openApiSchema = modifier.modify(openApiSchema);
          } catch (error) {
            const modifierName =
              typeof modifier === "function"
                ? "anonymous function"
                : modifier.name;
            console.error(`Error applying modifier ${modifierName}:`, error);
            // Continue with other modifiers instead of failing completely
          }
        }

        res.json(openApiSchema);
      } catch (error) {
        console.error("Error generating OpenAPI schema:", error);
        res.status(500).json({ error: "Failed to generate OpenAPI schema" });
      }
    });

    return router;
  }
}
