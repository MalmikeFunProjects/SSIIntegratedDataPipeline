import { OpenAPIV3 } from "openapi-types";
import {
  DualAuthApiSchemaRouterOptions,
  OpenAPISchemaModifier,
} from "../../config";

type RequireOnly<T, K extends keyof T> = Required<Pick<T, K>> &
  Partial<Omit<T, K>>;

/**
 * Enhanced DualAuth modifier implementing the OpenAPISchemaModifier interface
 */
export class DualAuthApiSchemaModifier implements OpenAPISchemaModifier {
  public readonly name = "DualAuthModifier";
  private options: Required<DualAuthApiSchemaRouterOptions>;

  constructor(
    options: RequireOnly<
      DualAuthApiSchemaRouterOptions,
      "exposedMethods" | "dualAuthMethods"
    >
  ) {
    // Validation
    if (
      options.dualAuthMethods &&
      options.exposedMethods &&
      !options.dualAuthMethods.every((method) =>
        options.exposedMethods.includes(method)
      )
    ) {
      throw new Error("All dualAuthMethods must be included in exposedMethods");
    }

    this.options = {
      exposedMethods: options.exposedMethods,
      dualAuthMethods: options.dualAuthMethods,
      primaryAuthName: options.primaryAuthName || "auth",
      secondaryAuthName: options.secondaryAuthName || "x-authorization",
      primaryAuthDescription:
        options.primaryAuthDescription ||
        "Primary bearer token for authentication",
      secondaryAuthDescription:
        options.secondaryAuthDescription ||
        "Secondary bearer token for issuer authorization",
      securityScheme: options.securityScheme || "bearer",
    };
  }

  validate(schema: OpenAPIV3.Document): boolean {
    // Ensure the schema has the expected structure
    return !!(schema.paths && typeof schema.paths === "object");
  }

  modify(schema: OpenAPIV3.Document): OpenAPIV3.Document {
    return this.addDualAuthToSchema(schema);
  }

  /**
   * Adds dual authentication support to an existing OpenAPI schema
   */
  private addDualAuthToSchema(schema: OpenAPIV3.Document): OpenAPIV3.Document {
    let modifiedSchema = { ...schema };

    // Initialize components if not present
    if (!modifiedSchema.components) {
      modifiedSchema.components = {};
    }

    // Set up security schemes
    modifiedSchema.components.securitySchemes = {
      ...modifiedSchema.components.securitySchemes,
      [this.options.primaryAuthName]: {
        type: "http",
        scheme: this.options.securityScheme,
        ...(this.options.securityScheme === "bearer" && {
          bearerFormat: "JWT",
        }),
        description: this.options.primaryAuthDescription,
      },
    };

    // Add secondary auth scheme if dual auth methods are specified
    if (
      this.options.dualAuthMethods &&
      this.options.dualAuthMethods.length > 0
    ) {
      modifiedSchema.components.securitySchemes[
        this.options.secondaryAuthName
      ] = {
        type: "apiKey",
        in: "header",
        name: this.options.secondaryAuthName,
        description:
          `${this.options.secondaryAuthDescription} (send as "${this.options.secondaryAuthName}: Bearer {token}")`,
      };
    }

    // Apply security to paths
    return this.applySecurityToPaths(modifiedSchema);
  }

  /**
   * Applies security requirements to specific paths based on configuration
   */
  private applySecurityToPaths(schema: OpenAPIV3.Document): OpenAPIV3.Document {
    Object.keys(schema.paths).forEach((pathKey) => {
      const pathItem = schema.paths[pathKey];
      if (pathItem?.post) {
        const methodName = pathItem.post.operationId;
        const requiresDualAuth =
          methodName && this.options.dualAuthMethods.includes(methodName);

        if (requiresDualAuth) {
          // Apply dual authentication (both tokens required)
          pathItem.post.security = [
            {
              [this.options.primaryAuthName]: [],
              [this.options.secondaryAuthName]: [],
            },
          ];
        } else {
          // Apply single authentication
          pathItem.post.security = [{ [this.options.primaryAuthName]: [] }];
        }

        // Add authentication/authorization error responses
        this.addAuthErrorResponses(pathItem.post);
      }
    });

    return schema;
  }

  /**
   * Adds standard authentication and authorization error responses
   */
  private addAuthErrorResponses(operation: OpenAPIV3.OperationObject) {
    if (!operation.responses["401"]) {
      operation.responses["401"] = {
        description:
          "Authentication failed - invalid or missing bearer token(s)",
        content: {
          "application/json; charset=utf-8": {
            schema: {
              type: "object",
              properties: {
                error: { type: "string" },
                message: { type: "string" },
              },
            },
          },
        },
      };
    }

    if (!operation.responses["403"]) {
      operation.responses["403"] = {
        description: "Authorization failed - insufficient permissions",
        content: {
          "application/json; charset=utf-8": {
            schema: {
              type: "object",
              properties: {
                error: { type: "string" },
                message: { type: "string" },
              },
            },
          },
        },
      };
    }
  }
}
