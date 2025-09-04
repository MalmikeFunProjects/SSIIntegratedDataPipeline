import { getDidKeyResolver } from "@veramo/did-provider-key";
import { DIDResolverPlugin, getUniversalResolver } from "@veramo/did-resolver";
import { Resolver, DIDResolver } from "did-resolver";
import { getResolver as getEthrResolver } from "ethr-did-resolver";
import { getResolver as getWebResolver } from "web-did-resolver";
import { getResolver as getPeerResolver } from "@veramo/did-provider-peer";
import { getDidJwkResolver } from "@veramo/did-provider-jwk";
import { getDidPkhResolver } from "@veramo/did-provider-pkh";
import { VeramoAgentConfig } from "../config";
import { CachedDidResolver } from "./veramo_cached_did_resolver";

class VeramoResolverManager {
  private config: VeramoAgentConfig;
  private cachedDidResolver: CachedDidResolver;

  constructor(config: VeramoAgentConfig) {
    this.config = config;
    this.cachedDidResolver = new CachedDidResolver();
  }

  createDIDResolverPlugin(): DIDResolverPlugin {
    const universalResolver = getUniversalResolver(
      this.config.universalResolverUrl ||
        "https://dev.uniresolver.io/1.0/identifiers/"
    )
    const resolverMap: Record<string, Record<string, DIDResolver>> = {
      ethr: getEthrResolver({ infuraProjectId: this.config.infuraProjectId }),
      web: getWebResolver(),
      key: getDidKeyResolver(),
      peer: getPeerResolver(),
      jwk: getDidJwkResolver(),
      pkh: getDidPkhResolver(),
      elem: { elem: universalResolver },
      io: { io: universalResolver },
      ion: { ion: universalResolver },
      sov: { sov: universalResolver },
    };

    const normalize = (v: string) => v.toLowerCase();
    const didProvider = normalize(process.env.DID_PROVIDER || "did:key").split(":");
    const didMethod = didProvider.length > 1? didProvider[1]: "key";
    const truthy = new Set(["1", "t", "true", "yes", "y"]);
    const cacheDid = truthy.has(normalize(process.env.CACHE_DID || "false"));

    let allResolvers: Record<string, DIDResolver> = {}
    let skipCache: Array<string> = []
    Object.entries(resolverMap).forEach(([key, value])=> {
      allResolvers = {...allResolvers, ...value}
      if (key !== "ethr"){
        if((key === didMethod && !cacheDid) || key !== didMethod){
          skipCache.push(...Object.keys(value))
        }
      }
    })

    const resolvers = this.cachedDidResolver.createCachedResolvers(allResolvers, {
      max: 100,
      ttl: 1000 * 60 * 10, // 10 minutes
    }, skipCache)

    return new DIDResolverPlugin({
      resolver: new Resolver(resolvers),
    });
  }
}

export default VeramoResolverManager;
