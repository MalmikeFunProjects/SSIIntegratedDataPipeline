import {
  IPluginMethodMap,
  IDIDManager,
  IAgentContext,
  TKeyType,
  IIdentifier,
  IAgentPlugin,
} from "@veramo/core";

export interface IAuthorizationDIDPlugin extends IPluginMethodMap {
  authorizeDidCreation: (
    args: { baseUrl: string},
    context: IAgentContext<IDIDManager>
  ) => Promise<{ success: boolean; did?: IIdentifier; error?: string }>;
  getAuthorizationDid: (
    args: { baseUrl: string},
    context: IAgentContext<IDIDManager>
  ) => Promise<IIdentifier>;
}

export class AuthorizationDIDPlugin implements IAgentPlugin {
  readonly methods: IAuthorizationDIDPlugin;

  constructor() {
    this.methods = {
      authorizeDidCreation: this.authorizeDidCreation.bind(this),
      getAuthorizationDid: this.getAuthorizationDid.bind(this),
    };
  }

  private async authorizeDidCreation(
    args: { baseUrl: string},
    context: IAgentContext<IDIDManager>
  ): Promise<{ success: boolean; did?: IIdentifier; error?: string }> {
    try {
      const { agent } = context;
      const { baseUrl } = args;
      if (!baseUrl) throw Error("[authorizeDidCreation] baseUrl is required");
      const providerType = "did:key";

      const hostUrl = new URL(baseUrl);
      const alias = `did:key:${hostUrl.hostname}${(hostUrl.port ? `:${hostUrl.port}` : "")}`;

      const serverIdentifier = await agent.didManagerGetOrCreate({
        provider: providerType,
        alias: alias,
        options: {
          keyType: <TKeyType>"Ed25519",
        },
      });

      if (serverIdentifier && serverIdentifier?.did) {
        console.log("🆔 Authorization DID created:", serverIdentifier.did);
        return { success: true, did: serverIdentifier };
      }

      return { success: false, error: "Failed to create server DID" };
    } catch (error) {
      console.error("Error in authorizeDidCreation:", error);
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Unknown error occurred",
      };
    }
  }

  private async getAuthorizationDid(
    args: { baseUrl: string},
    context: IAgentContext<IDIDManager>
  ): Promise<IIdentifier> {
    const { agent } = context;
    const { baseUrl } = args;
    if (!baseUrl) throw Error("[getAuthorizationDid] baseUrl is required");
    const providerType = "did:key";

    const hostUrl = new URL(baseUrl);
    const alias = `did:key:${hostUrl.hostname}${(hostUrl.port ? `:${hostUrl.port}` : "")}`;

    try {
      const serverIdentifier = await agent.didManagerFind({
        alias: alias,
        provider: providerType,
      });
      if (!serverIdentifier || serverIdentifier.length === 0) {
        throw new Error("Authorization DID not found");
      }
      return serverIdentifier[0];
    } catch (error) {
      console.error("Error in getting authrization DID:", error);
      throw error;
    }
  }
};
